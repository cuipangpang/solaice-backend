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

    eye: `아래 세 장의 안구 이미지를 분석해 주세요（제1장：양안 전경, 제2장：왼눈 클로즈업, 제3장：오른눈 클로즈업）.

핵심 평가 항목：
1. 【좌우 대칭성】 양안의 크기, 개안 정도, 분비물 양, 충혈 정도를 비교하여 asymmetry_score를 산출하세요
2. 【결막 충혈】 충혈 범위와 깊이를 평가하세요
3. 【눈곱 및 분비물】 색상（투명/흰색/황록색）, 성상（수양성/점액성/가피 형성）
4. 【동공】 좌우 크기의 일치 여부, 혼탁 또는 이상 반사 여부
5. 【안검】 내번, 외번, 안검연염, 속눈썹 난생증 여부

【후보 진단 어휘집】primary_diagnosis와 symptoms[].name은 반드시 아래 용어 중에서 우선 인용하세요（원문 그대로 사용）：
대분류 참고：角膜疾病 | 结膜和巩膜疾病 | 眼睑疾病 | 第三眼睑疾病 | 泪液分泌异常 | 虹膜和瞳孔疾病 | 晶状体疾病 | 眼压相关疾病 | 分泌物异常
용어：角膜浑浊、角膜溃疡、角膜炎、角膜黑色素沉着、角膜白斑、结膜炎、巩膜充血、结膜水肿、睑内翻、睑外翻、眼睑炎、眼睑肿瘤、樱桃眼、第三眼睑增生、流泪症、干眼症、虹膜炎、瞳孔异常、虹膜异色、白内障、晶状体脱位、核硬化、青光眼、眼球内陷、眼球突出、健康眼睛、其他眼部状况`,

    oral: `아래 구강 이미지를 분석해 주세요.

핵심 평가 항목：
1. 【치은 건강】 색상（정상 분홍색 → 충혈 적색）, 부종 정도
2. 【치주 상태】 치석 등급（0–3등급）, 치은 퇴축 정도
3. 【구강 점막】 궤양, 신생물, 이상 색소 유무
4. 【치아】 균열, 결손, 변색 여부
5. 【구취 간접 평가】 치석량과 염증 소견을 통한 간접 추정

【후보 진단 어휘집】primary_diagnosis와 symptoms[].name은 반드시 아래 용어 중에서 우선 인용하세요（원문 그대로 사용）：
용어：牙周炎、牙结石、牙垢、牙龈红肿、牙龈炎、牙齿缺失、牙齿磨损、牙齿变色、龋齿、牙齿裂纹、牙龈萎缩、牙釉质发育不全、口腔肿瘤`,

    skin: `아래 피부/피모 이미지를 분석해 주세요.

핵심 평가 항목：
1. 【피부 색상】 충혈, 청색증, 황달 소견
2. 【피부 병변 유형】 구진, 농포, 가피, 궤양, 과각화 여부
3. 【피모 상태】 탈모 면적, 모색 광택, 모간 손상 및 탈모 양상
4. 【염증 정도】 국소 열감 소견, 부종 여부
5. 【기생충 흔적】 벼룩 분변（흑색 과립）, 모낭충 감염 흔적（피부 터널 형성）
6. 【혈흔 또는 삼출액】 혈흔 비율

【후보 진단 어휘집】primary_diagnosis와 symptoms[].name은 반드시 아래 용어 중에서 우선 인용하세요（원문 그대로 사용）：
대분류 참고：真菌类 | 寄生虫类 | 细菌类 | 过敏免疫类
용어：癣、马拉色菌感染、疥癣、蠕形螨病、耳螨、蜱虫感染、跳蚤过敏性皮炎、细菌性皮炎、毛囊炎、过敏性皮炎、特应性皮炎、热点、脂溢性皮炎、健康皮肤、其他`,

    ear: `아래 귀 이미지를 분석해 주세요.

핵심 평가 항목：
1. 【이도 분비물】 색상（갈색/검정/노란색/혈성）, 성상
2. 【이개 충혈】 충혈 범위와 정도
3. 【염증성 부종】 이도 협착 정도
4. 【귀 진드기（이개진드기）특징】 진한 갈색의 건조한 과립상 분비물
5. 【혈흔 및 삼출액】 혈흔 비율

【후보 진단 어휘집】primary_diagnosis와 symptoms[].name은 반드시 아래 용어 중에서 우선 인용하세요（원문 그대로 사용）：
대분류 참고：细菌性感染 | 真菌性感染 | 过敏性耳炎 | 寄生虫性耳炎
용어：球菌感染、杆菌感染、马拉色菌感染、耳真菌病、过敏性耳炎、耳螨、蠕形螨、疥螨、耳道增生、耳道异物、鼓膜破裂、耳道狭窄、健康耳道、其他耳道状况`,

    excrement: `아래 분변 이미지를 분석하여 내용물 성분（content_findings）을 상세히 파악해 주세요.

핵심 평가 항목：
1. 【색상】 정상 갈색 / 흑색（상부 소화관 출혈）/ 선홍색（하부 소화관 출혈）/ 백색（담도 폐쇄）/ 녹색（담즙 과다）
2. 【성상】 성형 / 연변 / 수양성 / 점액 혼합
3. 【이물질 확인】 골편, 털, 직물, 플라스틱, 식물 섬유
4. 【기생충】 회충（백색 가는 선상）, 조충 편절（쌀알 모양）, 콕시듐
5. 【혈흔 비율】 선홍색 vs 흑색 타르변

【분변 성상 분류（브리스톨 척도 변형）】content_findings의 첫 번째 항목에 아래 용어 중 하나를 그대로 사용하여 분변 전체 형태를 기술하세요：
용어：干燥硬便、略干成形便、理想健康便、健康偏软便、软便、软烂不成形便、稀糊状便、严重水样便、完全水样腹泻

content_findings에는 항목별로 나열하세요：첫 번째 항목은 분변 성상 분류 용어, 이후 각 항목에는 색상 특징, 이물질 및 기생충을 기술하세요.`,

    vomit: `아래 구토물 이미지를 분석하여 내용물 성분（content_findings）을 상세히 파악해 주세요.

핵심 평가 항목：
1. 【내용물 유형】 미소화 음식물 / 반소화 식미 / 순수 위액 / 담즙 / 거품 / 모구（헤어볼）
2. 【색상별 임상 의미】 황록색＝담즙 역류 / 선홍색＝출혈 / 커피 찌꺼기색＝오래된 출혈 / 투명 백색＝공복 구토
3. 【이물질 확인】 골편, 장난감 파편, 식물 잎（중독 위험）, 끈 또는 실 종류
4. 【기생충】 회충
5. 【혈흔 비율】（3% 초과 시 즉시 내원 필요）

content_findings에 발견된 내용물을 항목별로 나열하세요.`,
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
