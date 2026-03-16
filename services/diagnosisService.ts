/**
 * diagnosisService.ts — AI 宠物健康诊断服务
 *
 * 架构设计：
 *   1. 本地紧急触发器 ── blood_ratio > 0.05 立即报警，不等待 AI 返回
 *   2. 结构化诊断输出 ── primary_diagnosis / symptoms / urgency / action_plan / home_care
 *   3. Knowledge Anchoring ── 每个模块携带专属候选诊断词库，强制模型引用专业术语
 *   4. 眼部多图逻辑 ── 一次性发送全景图 + 左眼 + 右眼三张图
 *   5. Mock 模式 ── 无需 API Key，延迟 1.5 s 返回符合格式的模拟数据
 *
 * 环境变量：
 *   EXPO_PUBLIC_QWEN_API_KEY — 阿里云百炼国际版 API Key
 *   若未设置，自动降级到 mockDiagnose。
 */

import * as ImageManipulator from "expo-image-manipulator";

// ── 公共类型 ─────────────────────────────────────────────────

export type ModuleKey =
  | "skin"
  | "oral"
  | "ear"
  | "eye"
  | "excrement"
  | "vomit";

/** 单条症状（结构化） */
export interface Symptom {
  /** 症状名称，优先来自候选词库 */
  name: string;
  /** 严重程度 */
  severity: "轻度" | "中度" | "重度";
  /** 具体位置，如「右眼结膜」 */
  location: string;
  /** 视觉证据描述，20字以内 */
  evidence: string;
}

/** 诊断输入参数 */
export interface DiagnosisInput {
  module: ModuleKey;
  /**
   * 裁切后的图片 URI 列表。
   * 普通模块传 1 个，眼部模块需传 3 个：[全景, 左眼, 右眼]
   */
  imageUris: string[];
  /**
   * 预计算的血迹像素占比（0–1）。
   * 若超过 0.05，在调用 API 前立即触发紧急报警。
   */
  blood_ratio?: number;
}

/** 诊断输出结果 */
export interface DiagnosisResult {
  module: ModuleKey;

  // ── 结构化诊断字段（新增）──────────────────────────────────
  /** 主诊断名称，优先来自候选词库 */
  primary_diagnosis: string;
  /** AI 置信度定性 */
  confidence_level: "高" | "中" | "低";
  /** 判断依据，简短罗列关键视觉证据 */
  reasoning: string;
  /** 症状列表，含严重程度；无异常时为空数组 */
  symptoms: Symptom[];
  /** 紧迫程度：正常/注意/就医/紧急（紧急仅由本地规则触发） */
  urgency: "正常" | "注意" | "就医" | "紧急";
  /** 行动建议，80-120字 */
  action_plan: string;
  /** 居家护理建议，50-80字 */
  home_care: string;

  // ── 保留字段（兼容旧 UI / 本地规则输出）────────────────────
  /** 健康评分 0–100，由 urgency 计算 */
  health_score: number;
  /** 炎症评分，由 symptoms severity 计算 */
  inflammation_score: number;
  /** 红色通道偏差量，保留用于数值展示 */
  redness_delta: number;
  /** 对称性评分 0–1，仅眼部模块返回 */
  asymmetry_score?: number;
  /** 血迹像素占比 0–1 */
  blood_ratio: number;
  /** 异常描述列表，由 symptoms 提取 */
  anomalies: string[];
  /** 内容物成分列表，仅呕吐物 / 粪便模块 */
  content_findings?: string[];
  /** 诊断置信度 0–1，由 confidence_level 计算 */
  confidence: number;
  /** 等同于 action_plan，保留给旧 UI */
  advice: string;
  severity: "normal" | "caution" | "visit" | "emergency";
  is_emergency: boolean;
  /**
   * true = 内容安全审核拦截后自动降级为 Mock 参考结果。
   * UI 层可据此显示「参考模式」提示。
   */
  is_content_filtered?: boolean;
}

// ── 配置 ─────────────────────────────────────────────────────

const API_KEY  = process.env.EXPO_PUBLIC_QWEN_API_KEY;
const API_URL  = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
const API_MODEL = "qwen-vl-max";
const BLOOD_RATIO_THRESHOLD = 0.05;

// ── 辅助转换 ──────────────────────────────────────────────────

function urgencyToHealthScore(u: string): number {
  if (u === "正常") return 90;
  if (u === "注意") return 65;
  if (u === "就医") return 35;
  return 8; // 紧急
}

function urgencyToSeverity(u: string): "normal" | "caution" | "visit" | "emergency" {
  if (u === "正常") return "normal";
  if (u === "注意") return "caution";
  if (u === "就医") return "visit";
  return "emergency";
}

function confidenceLevelToNumber(level: string): number {
  if (level === "高") return 0.90;
  if (level === "中") return 0.70;
  return 0.45;
}

function symptomsToInflammationScore(symptoms: Symptom[]): number {
  if (symptoms.length === 0) return 0;
  return symptoms.reduce((max, s) => {
    const v = s.severity === "重度" ? 82 : s.severity === "中度" ? 52 : 22;
    return Math.max(max, v);
  }, 0);
}

function symptomsToAnomalies(symptoms: Symptom[]): string[] {
  return symptoms.map((s) =>
    s.location
      ? `${s.name}（${s.location}，${s.severity}）`
      : `${s.name}（${s.severity}）`,
  );
}

/** 将所有新字段 + 计算字段合并为完整 DiagnosisResult */
function buildFullResult(
  module: ModuleKey,
  data: {
    primary_diagnosis: string;
    confidence_level: "高" | "中" | "低";
    reasoning: string;
    symptoms: Symptom[];
    urgency: "正常" | "注意" | "就医" | "紧急";
    action_plan: string;
    home_care: string;
    asymmetry_score?: number;
    blood_ratio: number;
    content_findings?: string[];
  },
  is_emergency = false,
): DiagnosisResult {
  const urgency = is_emergency ? "紧急" : data.urgency;
  return {
    module,
    primary_diagnosis:  data.primary_diagnosis,
    confidence_level:   data.confidence_level,
    reasoning:          data.reasoning,
    symptoms:           data.symptoms,
    urgency,
    action_plan:        data.action_plan,
    home_care:          data.home_care,
    // 计算型保留字段
    health_score:       is_emergency ? 8 : urgencyToHealthScore(data.urgency),
    inflammation_score: symptomsToInflammationScore(data.symptoms),
    redness_delta:      40,
    asymmetry_score:    data.asymmetry_score,
    blood_ratio:        data.blood_ratio,
    anomalies:          symptomsToAnomalies(data.symptoms),
    content_findings:   data.content_findings,
    confidence:         confidenceLevelToNumber(data.confidence_level),
    advice:             data.action_plan,
    severity:           is_emergency ? "emergency" : urgencyToSeverity(data.urgency),
    is_emergency,
  };
}

// ── 本地紧急触发器 ────────────────────────────────────────────

function isLocalEmergency(bloodRatio: number): boolean {
  return bloodRatio > BLOOD_RATIO_THRESHOLD;
}

function buildEmergencyResult(module: ModuleKey, bloodRatio: number): DiagnosisResult {
  return buildFullResult(
    module,
    {
      primary_diagnosis: "疑似活动性出血",
      confidence_level:  "高",
      reasoning:         `图像血迹像素占比 ${(bloodRatio * 100).toFixed(1)}%，超过安全阈值（5%）`,
      symptoms: [
        {
          name:     "血迹",
          severity: "重度",
          location: "图像主体区域",
          evidence: `血迹像素占比 ${(bloodRatio * 100).toFixed(1)}%`,
        },
      ],
      urgency:      "紧急",
      action_plan:  "图像中检测到明显血迹，占比超过安全阈值（5%）。请立即前往最近的动物医院急诊，不要等待。",
      home_care:    "就医途中保持宠物安静，用干净布料轻压伤口，避免宠物舔舐患处。",
      blood_ratio:  bloodRatio,
    },
    true,
  );
}

// ── System Prompt ─────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `반드시 한국어로 답변하세요. 진단 결과, 증상, 행동 권고, 가정 간호 내용을 모두 한국어로 작성하세요.

당신은 반려동물 의료 이미지 분석에 특화된 숙련된 AI 진단 어시스턴트입니다.

아래 JSON 형식으로만 진단 결과를 출력하세요. 추가 텍스트나 마크다운 코드블록을 포함하지 마세요:

{
  "primary_diagnosis": "<한국어로 주요 진단명 — 【후보 진단 어휘집】 용어 우선 사용; 이상 없을 경우 「전반적으로 양호」>",
  "confidence": "<高/中/低>",
  "reasoning": "<한국어로 판단 근거 — 주요 시각적 증거 나열, 50자 이내>",
  "symptoms": [
    {
      "name": "<한국어로 증상명 — 후보 어휘집 용어 우선 사용>",
      "severity": "<轻度/中度/重度>",
      "location": "<한국어로 구체적 위치, 예: 「우안 결막」 「좌측 귓바퀴」>",
      "evidence": "<한국어로 시각적 증거, 20자 이내>"
    }
  ],
  "urgency": "<正常/注意/就医>",
  "action_plan": "<한국어로 행동 권고 — 80~120자, 부드럽고 구체적으로>",
  "home_care": "<한국어로 가정 간호 권고 — 50~80자, 쉽고 실행 가능하게>",
  "content_findings": ["<한국어로 내용물 설명1>", "<한국어로 내용물 설명2>"],
  "asymmetry_score": 0.00
}

규칙:
- primary_diagnosis, reasoning, action_plan, home_care, symptoms[].name/location/evidence, content_findings 는 반드시 한국어로 작성
- urgency, confidence, symptoms[].severity 는 열거형 값을 그대로 사용: urgency(正常/注意/就医), confidence(高/中/低), severity(轻度/中度/重度)
- symptoms 이상 없을 경우 빈 배열 []
- urgency 는 세 가지 값만 허용: 正常(처치 불필요) / 注意(가정 관찰) / 就医(병원 필요)
  「紧急」은 로컬 규칙으로만 트리거되므로 출력에 포함 금지
- confidence: 高=명확한 시각적 증거 다수 | 中=불확실하거나 증거 1개 | 低=이미지 품질 불량
- 이미지 품질 불량 시 confidence 는 「低」로, action_plan 에 재촬영 권장 문구 포함
- primary_diagnosis 와 symptoms[].name 은 사용자 메시지의 【후보 진단 어휘집】 용어 우선 인용
- content_findings 는 배설물/구토물 모듈에만 작성, 나머지 모듈은 이 필드 생략
- asymmetry_score 는 눈 모듈에만 작성(0=완전 대칭), 나머지 모듈은 이 필드 생략

반드시 한국어로 답변하세요. 진단 결과, 증상, 행동 권고, 가정 간호 내용을 모두 한국어로 작성하세요.`;
}

// ── 模块 User Prompt（含 Knowledge Anchoring）─────────────────

function buildUserPrompt(module: ModuleKey): string {
  const modulePrompts: Record<ModuleKey, string> = {

    eye: `请分析以下三张眼部图像（第1张：双眼全景，第2张：左眼特写，第3张：右眼特写）。

核心评估项：
1. 【左右对称性】对比两眼大小、睁眼程度、分泌物量、充血程度，输出 asymmetry_score
2. 【结膜充血】评估充血范围与深度
3. 【眼部分泌物】颜色（透明/白色/黄绿色）、质地（水样/黏稠/结痂）
4. 【瞳孔】大小是否一致，是否有混浊或异常反射
5. 【眼睑】是否有内翻、外翻、睑缘炎、睫毛倒置

【候选诊断词库】primary_diagnosis 和 symptoms[].name 必须优先引用以下词条（直接使用原文）：
大类参考：角膜疾病 | 结膜和巩膜疾病 | 眼睑疾病 | 第三眼睑疾病 | 泪液分泌异常 | 虹膜和瞳孔疾病 | 晶状体疾病 | 眼压相关疾病 | 分泌物异常
词条：角膜浑浊、角膜溃疡、角膜炎、角膜黑色素沉着、角膜白斑、结膜炎、巩膜充血、结膜水肿、睑内翻、睑外翻、眼睑炎、眼睑肿瘤、樱桃眼、第三眼睑增生、流泪症、干眼症、虹膜炎、瞳孔异常、虹膜异色、白内障、晶状体脱位、核硬化、青光眼、眼球内陷、眼球突出、健康眼睛、其他眼部状况`,

    oral: `请分析这张口腔图像。

核心评估项：
1. 【牙龈健康】颜色（正常粉色→充血红色）、水肿程度
2. 【牙周状况】牙石分级（0–3级）、牙龈萎缩程度
3. 【口腔黏膜】有无溃疡、新生物、异常色素
4. 【牙齿】裂齿、缺损、变色
5. 【整体气味迹象】通过图像间接推断（牙石量、炎症程度）

【候选诊断词库】primary_diagnosis 和 symptoms[].name 必须优先引用以下词条（直接使用原文）：
词条：牙周炎、牙结石、牙垢、牙龈红肿、牙龈炎、牙齿缺失、牙齿磨损、牙齿变色、龋齿、牙齿裂纹、牙龈萎缩、牙釉质发育不全、口腔肿瘤`,

    skin: `请分析这张皮肤/被毛图像。

核心评估项：
1. 【皮肤颜色】充血、发绀、黄疸迹象
2. 【皮损类型】丘疹、脓疱、结痂、溃疡、过度角化
3. 【被毛状态】脱毛面积、毛色光泽、断毛
4. 【炎症程度】局部热感迹象、肿胀
5. 【寄生虫痕迹】跳蚤粪便（黑色颗粒）、螨虫管道
6. 【血迹或渗液】血迹占比

【候选诊断词库】primary_diagnosis 和 symptoms[].name 必须优先引用以下词条（直接使用原文）：
大类参考：真菌类 | 寄生虫类 | 细菌类 | 过敏免疫类
词条：癣、马拉色菌感染、疥癣、蠕形螨病、耳螨、蜱虫感染、跳蚤过敏性皮炎、细菌性皮炎、毛囊炎、过敏性皮炎、特应性皮炎、热点、脂溢性皮炎、健康皮肤、其他`,

    ear: `请分析这张耳部图像。

核心评估项：
1. 【耳道分泌物】颜色（棕色/黑色/黄色/血性）、质地
2. 【耳廓充血】充血范围与程度
3. 【炎症肿胀】耳道狭窄程度
4. 【耳螨特征】深棕色干燥颗粒状分泌物
5. 【血迹与渗液】血迹占比

【候选诊断词库】primary_diagnosis 和 symptoms[].name 必须优先引用以下词条（直接使用原文）：
大类参考：细菌性感染 | 真菌性感染 | 过敏性耳炎 | 寄生虫性耳炎
词条：球菌感染、杆菌感染、马拉色菌感染、耳真菌病、过敏性耳炎、耳螨、蠕形螨、疥螨、耳道增生、耳道异物、鼓膜破裂、耳道狭窄、健康耳道、其他耳道状况`,

    excrement: `请分析这张粪便图像，详细识别内容物成分（content_findings）。

核心评估项：
1. 【颜色】正常棕色 / 黑色（上消化道出血）/ 鲜红（下消化道出血）/ 白色（胆道梗阻）/ 绿色（胆汁过多）
2. 【质地】成形 / 软便 / 稀水样 / 带黏液
3. 【异物识别】骨片、毛发、布料、塑料、植物纤维
4. 【寄生虫】蛔虫（白色细条）、绦虫节片（米粒状）、球虫
5. 【血迹占比】鲜红 vs 柏油色

【粪便形态分级（布里斯托变体）】请在 content_findings 的第一条，使用以下词条之一描述粪便整体形态（直接使用原文）：
词条：干燥硬便、略干成形便、理想健康便、健康偏软便、软便、软烂不成形便、稀糊状便、严重水样便、完全水样腹泻

请在 content_findings 中逐条列出：第1条为粪便形态分级词条，后续各条列出颜色特征、异物及寄生虫。`,

    vomit: `请分析这张呕吐物图像，详细识别内容物成分（content_findings）。

核心评估项：
1. 【内容物类型】未消化食物 / 半消化食糜 / 纯胃液 / 胆汁 / 泡沫 / 毛球
2. 【颜色含义】黄绿色=胆汁反流 / 鲜红=出血 / 咖啡渣色=陈旧出血 / 透明白色=空腹
3. 【异物识别】骨片、玩具碎片、植物叶片（中毒风险）、绳线类
4. 【寄生虫】蛔虫
5. 【血迹占比】（>3% 须立即就医）

请在 content_findings 中逐条列出发现的内容物。`,
  };

  const KO_SUFFIX = `\n\n반드시 한국어로 답변하세요. 진단 결과, 증상, 행동 권고, 가정 간호 내용을 모두 한국어로 작성하세요.`;
  return modulePrompts[module] + KO_SUFFIX;
}

// ── 图片转 Base64 ─────────────────────────────────────────────

async function uriToBase64(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1024 } }],
    {
      compress: 0.75,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    },
  );
  if (!result.base64) {
    throw new Error(`[diagnosisService] 图片转 Base64 失败: ${uri}`);
  }
  return result.base64;
}

// ── Mock 诊断数据 ─────────────────────────────────────────────

type MockData = Parameters<typeof buildFullResult>[1];

const MOCK_DATA: Record<ModuleKey, MockData> = {
  eye: {
    primary_diagnosis: "结膜炎",
    confidence_level:  "中",
    reasoning:         "右眼结膜充血，分泌物量多于左眼，左右轻度不对称（asymmetry 0.18）",
    symptoms: [
      { name: "结膜炎", severity: "轻度", location: "右眼结膜", evidence: "轻度充血，水样分泌物增多" },
      { name: "流泪症", severity: "轻度", location: "右眼内角", evidence: "分泌物量略多于左眼" },
    ],
    urgency:      "注意",
    action_plan:  "右眼发现轻微充血，可能为过敏或轻度结膜炎所致。左右眼存在轻度不对称。建议观察3-5天，每天用湿润棉球由眼角向外轻柔擦拭分泌物。若充血加重、分泌物变黄绿色或宠物频繁抓眼，请及时就诊。",
    home_care:    "每天用湿润棉球从眼角向外擦拭，避免宠物抓眼，观察左右对比变化。",
    asymmetry_score: 0.18,
    blood_ratio:  0.00,
  },

  oral: {
    primary_diagnosis: "牙周炎",
    confidence_level:  "高",
    reasoning:         "牙石沉积明显（2-3级），牙龈充血红肿，边缘水肿，炎症中等偏重",
    symptoms: [
      { name: "牙结石",  severity: "中度", location: "全口牙龈线",  evidence: "黄褐色硬质沉积，2-3级" },
      { name: "牙龈炎",  severity: "中度", location: "牙龈边缘",    evidence: "充血红肿，轻度水肿" },
      { name: "牙龈红肿", severity: "轻度", location: "下颌前齿区", evidence: "颜色偏红，触感偏软" },
    ],
    urgency:      "就医",
    action_plan:  "牙龈炎症中等偏重，牙石积累较多，是慢性牙周炎的早期信号。建议在兽医指导下进行超声洁牙，评估是否需要抗炎治疗。洁牙后定期复查，防止复发。",
    home_care:    "每2天用宠物专用牙刷+宠物牙膏刷牙，辅以磨牙玩具或洁牙零食减缓牙石再沉积。避免高糖饮食。",
    blood_ratio:  0.00,
  },

  skin: {
    primary_diagnosis: "过敏性皮炎",
    confidence_level:  "中",
    reasoning:         "局部脱毛约2cm²伴皮肤轻微发红，无明显皮损或感染迹象",
    symptoms: [
      { name: "过敏性皮炎", severity: "轻度", location: "局部皮肤", evidence: "小面积脱毛，轻微发红" },
    ],
    urgency:      "注意",
    action_plan:  "皮肤整体状态良好，发现局部小片脱毛伴轻微红肿，可能为接触性过敏或自舔引发。建议检查床垫、清洁产品是否有刺激成分，保持患处干燥。若脱毛面积扩大或出现破溃、结痂，需就诊进行皮肤刮片检查。",
    home_care:    "保持患处干燥清洁，避免宠物舔舐，可使用宠物专用防舔颈圈。检查并更换低刺激性洗护产品。",
    blood_ratio:  0.00,
  },

  ear: {
    primary_diagnosis: "耳螨",
    confidence_level:  "高",
    reasoning:         "耳道棕黑色干燥颗粒状分泌物堆积，耳廓充血，符合耳螨感染典型特征",
    symptoms: [
      { name: "耳螨",        severity: "中度", location: "双侧耳道",   evidence: "棕黑色颗粒状分泌物堆积" },
      { name: "马拉色菌感染", severity: "轻度", location: "耳廓内侧",   evidence: "轻度充血，油脂分泌偏多" },
    ],
    urgency:      "就医",
    action_plan:  "耳道有较多棕色分泌物，颜色和质地高度提示耳螨感染。建议尽快就诊，由兽医确认并开具驱螨药物，需完整疗程（通常3-4周）防止复发。",
    home_care:    "就诊前用宠物耳道清洁液轻柔按摩耳根后让宠物甩耳，避免棉签深插。若宠物频繁抓耳，可暂戴防抓颈圈。",
    blood_ratio:  0.00,
  },

  excrement: {
    primary_diagnosis: "健康偏软便",
    confidence_level:  "中",
    reasoning:         "粪便偏软、颜色偏深棕，形态符合「健康偏软便」分级，无血迹及异物",
    symptoms: [],
    urgency:      "注意",
    action_plan:  "粪便偏软且颜色偏深，可能与近期饮食变化、进食过快或轻度肠道应激有关。建议暂停零食，改喂清淡易消化饮食1-2天，确保充足饮水。若持续腹泻超过24小时，或出现血便、精神萎靡，请立即就诊。",
    home_care:    "减少零食，提供清淡食物，多补充水分。记录排便频次和性状变化，作为就诊参考。",
    blood_ratio:  0.01,
    content_findings: [
      "健康偏软便",
      "颜色：深棕色（提示消化时间偏短）",
      "质地：软便，轻度黏液覆盖",
      "未见明显异物",
      "未见可见寄生虫",
    ],
  },

  vomit: {
    primary_diagnosis: "进食过快导致呕吐",
    confidence_level:  "高",
    reasoning:         "呕吐物主要为未消化干粮，少量黄色胃液，无血迹及异物",
    symptoms: [],
    urgency:      "注意",
    action_plan:  "呕吐物主要为未消化食物，提示进食过快或一次进食量过多。建议改为少量多餐（每日3-4次），并使用防狼吞慢食碗。进食后30分钟内避免剧烈运动。若每日呕吐超过3次或出现血迹，请立即就诊。",
    home_care:    "使用慢食碗，减少每次进食量，增加喂食频次。进食后让宠物安静休息30分钟。",
    blood_ratio:  0.00,
    content_findings: [
      "主要成分：未消化干粮颗粒（约70%）",
      "少量黄色胃液（约30%）",
      "未见血迹",
      "未见异物（骨片、布料等）",
      "未见可见寄生虫",
    ],
  },
};

/**
 * mockDiagnose — 无需 API Key，1.5s 后返回符合格式的模拟结果。
 */
export async function mockDiagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
  const bloodRatio = input.blood_ratio ?? 0;
  if (isLocalEmergency(bloodRatio)) {
    return buildEmergencyResult(input.module, bloodRatio);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  return buildFullResult(input.module, { ...MOCK_DATA[input.module] });
}

// ── 真实 API 调用 ─────────────────────────────────────────────

export async function callDiagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
  const bloodRatio = input.blood_ratio ?? 0;
  if (isLocalEmergency(bloodRatio)) {
    return buildEmergencyResult(input.module, bloodRatio);
  }

  const base64List = await Promise.all(input.imageUris.map(uriToBase64));

  const imageBlocks = base64List.map((b64) => ({
    type: "image_url" as const,
    image_url: { url: `data:image/jpeg;base64,${b64}` },
  }));

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        ...imageBlocks,
        { type: "text", text: buildUserPrompt(input.module) },
      ],
    },
  ];

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY ?? ""}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ model: API_MODEL, max_tokens: 1200, messages }),
  });

  if (!response.ok) {
    const errText = await response.text();

    // 阿里云内容安全审核拦截（常见于粪便、伤口、分泌物等医疗动物图片）
    // 自动降级为 Mock 参考结果，避免用户看到纯错误页面
    let isContentFiltered = false;
    try {
      const errJson = JSON.parse(errText);
      if (errJson?.error?.code === "data_inspection_failed") {
        isContentFiltered = true;
      }
    } catch { /* errText 非 JSON，忽略 */ }

    if (isContentFiltered) {
      console.warn("[diagnosisService] 内容安全审核拦截，降级为 Mock 参考模式");
      const mockResult = await mockDiagnose(input);
      return { ...mockResult, is_content_filtered: true };
    }

    throw new Error(`[diagnosisService] API error ${response.status}: ${errText}`);
  }

  const data    = await response.json();
  const rawText = (data.choices?.[0]?.message?.content ?? "{}") as string;
  return parseAPIResponse(rawText, input.module, bloodRatio);
}

/**
 * diagnose — 主入口。
 * 有 API Key → 调用真实接口；无 Key → 自动降级到 mockDiagnose。
 */
export async function diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
  if (!API_KEY) return mockDiagnose(input);
  return callDiagnose(input);
}

// ── 解析工具 ──────────────────────────────────────────────────

function parseAPIResponse(
  rawText: string,
  module: ModuleKey,
  inputBloodRatio: number,
): DiagnosisResult {
  let parsed: Record<string, unknown> = {};
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    console.warn("[diagnosisService] Failed to parse API response:", rawText);
  }

  // 解析 symptoms 数组
  const rawSymptoms = Array.isArray(parsed.symptoms) ? parsed.symptoms : [];
  const symptoms: Symptom[] = (rawSymptoms as unknown[]).map((s) => {
    const obj = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      name:     typeof obj.name     === "string" ? obj.name     : "未知症状",
      severity: (["轻度","中度","重度"].includes(obj.severity as string)
        ? obj.severity : "轻度") as "轻度" | "中度" | "重度",
      location: typeof obj.location === "string" ? obj.location : "",
      evidence: typeof obj.evidence === "string" ? obj.evidence : "",
    };
  });

  const rawUrgency  = parsed.urgency as string;
  const urgency     = (["正常","注意","就医"].includes(rawUrgency) ? rawUrgency : "注意") as "正常" | "注意" | "就医";

  const rawConf     = parsed.confidence as string;
  const confLevel   = (["高","中","低"].includes(rawConf) ? rawConf : "中") as "高" | "中" | "低";

  const bloodRatio  = clamp(Number((parsed.blood_ratio as number) ?? inputBloodRatio), 0, 1);
  const isEmerg     = isLocalEmergency(bloodRatio);

  const actionPlan  = typeof parsed.action_plan === "string" ? parsed.action_plan : "请继续观察宠物状态，如有异常请及时就诊。";
  const homeCare    = typeof parsed.home_care    === "string" ? parsed.home_care    : "";

  return buildFullResult(
    module,
    {
      primary_diagnosis: typeof parsed.primary_diagnosis === "string" ? parsed.primary_diagnosis : "分析完成",
      confidence_level:  confLevel,
      reasoning:         typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      symptoms,
      urgency,
      action_plan:       actionPlan,
      home_care:         homeCare,
      asymmetry_score:   parsed.asymmetry_score != null ? clamp(Number(parsed.asymmetry_score), 0, 1) : undefined,
      blood_ratio:       bloodRatio,
      content_findings:  Array.isArray(parsed.content_findings)
        ? (parsed.content_findings as string[])
        : undefined,
    },
    isEmerg,
  );
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
