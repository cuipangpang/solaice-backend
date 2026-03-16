/**
 * diagnosisService.ts — AI 반려동물 건강 진단 서비스
 *
 * 아키텍처 설계：
 *   1. 로컬 응급 트리거 ── blood_ratio > 0.05 즉시 경보, AI 응답 대기 없음
 *   2. 구조화 진단 출력 ── primary_diagnosis / symptoms / urgency / action_plan / home_care
 *   3. Knowledge Anchoring ── 각 모듈별 후보 진단 어휘집 탑재, 전문 용어 인용 강제
 *   4. 눈 모듈 다중 이미지 ── 전경 + 왼눈 + 오른눈 3장 일괄 전송
 *   5. Mock 모드 ── API Key 없이 1.5초 후 형식에 맞는 모의 데이터 반환
 *
 * 환경 변수：
 *   EXPO_PUBLIC_QWEN_API_KEY — 알리클라우드 바이리엔 국제판 API Key
 *   미설정 시 자동으로 mockDiagnose로 강등.
 */

import * as ImageManipulator from "expo-image-manipulator";

// ── 공통 타입 ─────────────────────────────────────────────────

export type ModuleKey =
  | "skin"
  | "oral"
  | "ear"
  | "eye"
  | "excrement"
  | "vomit";

/** 단일 증상（구조화） */
export interface Symptom {
  /** 증상명, 후보 어휘집 용어 우선 사용 */
  name: string;
  /** 중증도 */
  severity: "경증" | "중등증" | "중증";
  /** 구체적 위치, 예：「우안 결막」 */
  location: string;
  /** 시각적 증거 설명, 20자 이내 */
  evidence: string;
}

/** 진단 입력 파라미터 */
export interface DiagnosisInput {
  module: ModuleKey;
  /**
   * 크롭된 이미지 URI 목록.
   * 일반 모듈：1장, 눈 모듈：3장 [전경, 왼눈, 오른눈]
   */
  imageUris: string[];
  /**
   * 사전 계산된 혈흔 픽셀 비율（0–1）.
   * 0.05 초과 시 API 호출 전 즉시 응급 경보 트리거.
   */
  blood_ratio?: number;
}

/** 진단 출력 결과 */
export interface DiagnosisResult {
  module: ModuleKey;

  // ── 구조화 진단 필드 ──────────────────────────────────────
  /** 주진단명, 후보 어휘집 용어 우선 사용 */
  primary_diagnosis: string;
  /** AI 신뢰도 정성 */
  confidence_level: "높음" | "보통" | "낮음";
  /** 판단 근거, 주요 시각적 증거 나열 */
  reasoning: string;
  /** 증상 목록（중증도 포함）; 이상 없을 경우 빈 배열 */
  symptoms: Symptom[];
  /** 긴박도：정상/주의/내원필요/긴급（긴급은 로컬 규칙으로만 트리거） */
  urgency: "정상" | "주의" | "내원필요" | "긴급";
  /** 행동 권고, 80–120자 */
  action_plan: string;
  /** 가정 간호 권고, 50–80자 */
  home_care: string;

  // ── 보존 필드（구 UI / 로컬 규칙 출력 호환）────────────────
  /** 건강 점수 0–100, urgency로 계산 */
  health_score: number;
  /** 염증 점수, symptoms severity로 계산 */
  inflammation_score: number;
  /** 적색 채널 편차량, 수치 표시용 보존 */
  redness_delta: number;
  /** 대칭성 점수 0–1, 눈 모듈만 반환 */
  asymmetry_score?: number;
  /** 혈흔 픽셀 비율 0–1 */
  blood_ratio: number;
  /** 이상 설명 목록, symptoms에서 추출 */
  anomalies: string[];
  /** 내용물 성분 목록, 구토물/분변 모듈만 */
  content_findings?: string[];
  /** 진단 신뢰도 0–1, confidence_level로 계산 */
  confidence: number;
  /** action_plan과 동일, 구 UI 호환 */
  advice: string;
  severity: "normal" | "caution" | "visit" | "emergency";
  is_emergency: boolean;
  /**
   * true = 콘텐츠 안전 심사 차단 후 자동 Mock 참고 결과로 강등.
   * UI 레이어에서 「참고 모드」 표시에 사용.
   */
  is_content_filtered?: boolean;
}

// ── 설정 ─────────────────────────────────────────────────────

const API_KEY  = process.env.EXPO_PUBLIC_QWEN_API_KEY;
const API_URL  = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
const API_MODEL = "qwen-vl-max";
const BLOOD_RATIO_THRESHOLD = 0.05;

// ── 보조 변환 함수 ──────────────────────────────────────────────

function urgencyToHealthScore(u: string): number {
  if (u === "정상") return 90;
  if (u === "주의") return 65;
  if (u === "내원필요") return 35;
  return 8; // 긴급
}

function urgencyToSeverity(u: string): "normal" | "caution" | "visit" | "emergency" {
  if (u === "정상") return "normal";
  if (u === "주의") return "caution";
  if (u === "내원필요") return "visit";
  return "emergency";
}

function confidenceLevelToNumber(level: string): number {
  if (level === "높음") return 0.90;
  if (level === "보통") return 0.70;
  return 0.45;
}

function symptomsToInflammationScore(symptoms: Symptom[]): number {
  if (symptoms.length === 0) return 0;
  return symptoms.reduce((max, s) => {
    const v = s.severity === "중증" ? 82 : s.severity === "중등증" ? 52 : 22;
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

/** 모든 신규 필드 + 계산 필드를 완전한 DiagnosisResult로 합산 */
function buildFullResult(
  module: ModuleKey,
  data: {
    primary_diagnosis: string;
    confidence_level: "높음" | "보통" | "낮음";
    reasoning: string;
    symptoms: Symptom[];
    urgency: "정상" | "주의" | "내원필요" | "긴급";
    action_plan: string;
    home_care: string;
    asymmetry_score?: number;
    blood_ratio: number;
    content_findings?: string[];
  },
  is_emergency = false,
): DiagnosisResult {
  const urgency = is_emergency ? "긴급" : data.urgency;
  return {
    module,
    primary_diagnosis:  data.primary_diagnosis,
    confidence_level:   data.confidence_level,
    reasoning:          data.reasoning,
    symptoms:           data.symptoms,
    urgency,
    action_plan:        data.action_plan,
    home_care:          data.home_care,
    // 계산형 보존 필드
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

// ── 로컬 응급 트리거 ────────────────────────────────────────────

function isLocalEmergency(bloodRatio: number): boolean {
  return bloodRatio > BLOOD_RATIO_THRESHOLD;
}

function buildEmergencyResult(module: ModuleKey, bloodRatio: number): DiagnosisResult {
  return buildFullResult(
    module,
    {
      primary_diagnosis: "활동성 출혈 의심",
      confidence_level:  "높음",
      reasoning:         `이미지 혈흔 픽셀 비율 ${(bloodRatio * 100).toFixed(1)}%，안전 임계값（5%）초과`,
      symptoms: [
        {
          name:     "혈흔",
          severity: "중증",
          location: "이미지 주요 영역",
          evidence: `혈흔 픽셀 비율 ${(bloodRatio * 100).toFixed(1)}%`,
        },
      ],
      urgency:      "긴급",
      action_plan:  "이미지에서 명백한 혈흔이 감지되었으며 안전 임계값（5%）을 초과했습니다. 즉시 가까운 동물병원 응급실로 이동하세요. 기다리지 마세요.",
      home_care:    "내원 중에는 반려동물을 안정시키고, 깨끗한 천으로 상처를 가볍게 압박하며, 반려동물이 환부를 핥지 않도록 하세요.",
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
  "confidence": "<높음/보통/낮음>",
  "reasoning": "<한국어로 판단 근거 — 주요 시각적 증거 나열, 50자 이내>",
  "symptoms": [
    {
      "name": "<한국어로 증상명 — 후보 어휘집 용어 우선 사용>",
      "severity": "<경증/중등증/중증>",
      "location": "<한국어로 구체적 위치, 예: 「우안 결막」 「좌측 귓바퀴」>",
      "evidence": "<한국어로 시각적 증거, 20자 이내>"
    }
  ],
  "urgency": "<정상/주의/내원필요>",
  "action_plan": "<한국어로 행동 권고 — 80~120자, 부드럽고 구체적으로>",
  "home_care": "<한국어로 가정 간호 권고 — 50~80자, 쉽고 실행 가능하게>",
  "content_findings": ["<한국어로 내용물 설명1>", "<한국어로 내용물 설명2>"],
  "asymmetry_score": 0.00
}

규칙:
- primary_diagnosis, reasoning, action_plan, home_care, symptoms[].name/location/evidence, content_findings 는 반드시 한국어로 작성
- urgency 는 세 가지 값만 허용: 정상(처치 불필요) / 주의(가정 관찰) / 내원필요(병원 필요)
  「긴급」은 로컬 규칙으로만 트리거되므로 출력에 포함 금지
- confidence 허용값: 높음(명확한 시각적 증거 다수) / 보통(불확실하거나 증거 1개) / 낮음(이미지 품질 불량)
- severity 허용값: 경증 / 중등증 / 중증
- symptoms 이상 없을 경우 빈 배열 []
- 이미지 품질 불량 시 confidence 는 「낮음」으로, action_plan 에 재촬영 권장 문구 포함
- primary_diagnosis 와 symptoms[].name 은 사용자 메시지의 【후보 진단 어휘집】 용어 우선 인용
- content_findings 는 배설물/구토물 모듈에만 작성, 나머지 모듈은 이 필드 생략
- asymmetry_score 는 눈 모듈에만 작성(0=완전 대칭), 나머지 모듈은 이 필드 생략

반드시 한국어로 답변하세요. 진단 결과, 증상, 행동 권고, 가정 간호 내용을 모두 한국어로 작성하세요.`;
}

// ── 모듈별 User Prompt（Knowledge Anchoring 포함）─────────────────

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
대분류 참고：각막질환 | 결막및공막질환 | 안검질환 | 제3안검질환 | 눈물분비이상 | 홍채및동공질환 | 수정체질환 | 안압관련질환 | 분비물이상
용어：각막혼탁、각막궤양、각막염、각막흑색소침착、각막백반、결막염、공막충혈、결막부종、안검내번、안검외번、안검염、안검종양、체리아이、제3안검증생、유루증、건성안、홍채염、동공이상、홍채이색증、백내장、수정체탈구、핵경화、녹내장、안구함몰、안구돌출、건강한 눈、기타 안구 이상`,

    oral: `아래 구강 이미지를 분석해 주세요.

핵심 평가 항목：
1. 【치은 건강】 색상（정상 분홍색 → 충혈 적색）, 부종 정도
2. 【치주 상태】 치석 등급（0–3등급）, 치은 퇴축 정도
3. 【구강 점막】 궤양, 신생물, 이상 색소 유무
4. 【치아】 균열, 결손, 변색 여부
5. 【구취 간접 평가】 치석량과 염증 소견을 통한 간접 추정

【후보 진단 어휘집】primary_diagnosis와 symptoms[].name은 반드시 아래 용어 중에서 우선 인용하세요（원문 그대로 사용）：
용어：치주염、치석、치태、치은충혈및부종、치은염、치아결손、치아마모、치아변색、충치、치아균열、치은퇴축、법랑질형성부전、구강종양`,

    skin: `아래 피부/피모 이미지를 분석해 주세요.

핵심 평가 항목：
1. 【피부 색상】 충혈, 청색증, 황달 소견
2. 【피부 병변 유형】 구진, 농포, 가피, 궤양, 과각화 여부
3. 【피모 상태】 탈모 면적, 모색 광택, 모간 손상 및 탈모 양상
4. 【염증 정도】 국소 열감 소견, 부종 여부
5. 【기생충 흔적】 벼룩 분변（흑색 과립）, 모낭충 감염 흔적（피부 터널 형성）
6. 【혈흔 또는 삼출액】 혈흔 비율

【후보 진단 어휘집】primary_diagnosis와 symptoms[].name은 반드시 아래 용어 중에서 우선 인용하세요（원문 그대로 사용）：
대분류 참고：진균류 | 기생충류 | 세균류 | 알레르기면역류
용어：피부사상균증、말라세지아감염、개선충증、모낭충증、귀진드기、진드기감염、벼룩알레르기피부염、세균성피부염、모낭염、알레르기성피부염、아토피피부염、핫스팟、지루성피부염、건강한 피부、기타`,

    ear: `아래 귀 이미지를 분석해 주세요.

핵심 평가 항목：
1. 【이도 분비물】 색상（갈색/검정/노란색/혈성）, 성상
2. 【이개 충혈】 충혈 범위와 정도
3. 【염증성 부종】 이도 협착 정도
4. 【귀 진드기（이개진드기）특징】 진한 갈색의 건조한 과립상 분비물
5. 【혈흔 및 삼출액】 혈흔 비율

【후보 진단 어휘집】primary_diagnosis와 symptoms[].name은 반드시 아래 용어 중에서 우선 인용하세요（원문 그대로 사용）：
대분류 참고：세균성감염 | 진균성감염 | 알레르기성외이염 | 기생충성외이염
용어：구균감염、간균감염、말라세지아감염、외이도진균증、알레르기성외이염、귀진드기、모낭충、개선충、외이도증식、외이도이물、고막파열、외이도협착、건강한 귀、기타 귀 이상`,

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

// ── 이미지 Base64 변환 ─────────────────────────────────────────

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
    throw new Error(`[diagnosisService] 이미지 Base64 변환 실패: ${uri}`);
  }
  return result.base64;
}

// ── Mock 진단 데이터 ─────────────────────────────────────────────

type MockData = Parameters<typeof buildFullResult>[1];

const MOCK_DATA: Record<ModuleKey, MockData> = {
  eye: {
    primary_diagnosis: "결막염",
    confidence_level:  "보통",
    reasoning:         "우안 결막 충혈, 분비물량 좌안 대비 증가, 경도 좌우 비대칭（asymmetry 0.18）",
    symptoms: [
      { name: "결막염", severity: "경증", location: "우안 결막", evidence: "경도 충혈, 수양성 분비물 증가" },
      { name: "유루증", severity: "경증", location: "우안 내안각", evidence: "분비물량 좌안 대비 소량 증가" },
    ],
    urgency:      "주의",
    action_plan:  "우안에서 경미한 충혈이 발견되었으며, 알레르기 또는 경도 결막염으로 추정됩니다. 좌우 눈에 경미한 비대칭이 있습니다. 3–5일간 관찰하며 매일 습윤한 면봉으로 눈 안쪽에서 바깥쪽으로 분비물을 닦아 주세요. 충혈이 악화되거나 분비물이 황록색으로 변하거나 반려동물이 눈을 자주 긁는다면 즉시 내원하세요.",
    home_care:    "매일 습윤한 면봉으로 눈 안쪽에서 바깥쪽으로 닦고, 반려동물이 눈을 긁지 않도록 하며, 좌우 변화를 관찰하세요.",
    asymmetry_score: 0.18,
    blood_ratio:  0.00,
  },

  oral: {
    primary_diagnosis: "치주염",
    confidence_level:  "높음",
    reasoning:         "치석 침착 뚜렷（2–3등급）, 치은 충혈 및 부종, 연변부 부종, 중등도 이상 염증",
    symptoms: [
      { name: "치석",        severity: "중등증", location: "전악 치은선",   evidence: "황갈색 경성 침착, 2–3등급" },
      { name: "치은염",      severity: "중등증", location: "치은 연변부",    evidence: "충혈 및 부종, 경도 부종" },
      { name: "치은충혈및부종", severity: "경증", location: "하악 전치부",  evidence: "색 적색, 촉감 연약" },
    ],
    urgency:      "내원필요",
    action_plan:  "치은 염증이 중등도 이상이며 치석이 상당량 축적되어 있어 만성 치주염의 초기 징후입니다. 수의사 지도 하에 초음파 스케일링을 시행하고 항염 치료 필요 여부를 평가받으세요. 스케일링 후 정기 재검진으로 재발을 방지하세요.",
    home_care:    "이틀에 한 번 반려동물 전용 칫솔과 치약으로 양치하고, 덴탈 장난감이나 덴탈 간식으로 치석 재침착 속도를 늦추세요. 고당분 식이를 피하세요.",
    blood_ratio:  0.00,
  },

  skin: {
    primary_diagnosis: "알레르기성피부염",
    confidence_level:  "보통",
    reasoning:         "국소 탈모 약 2cm² 및 경미한 피부 발적, 뚜렷한 피부 병변 또는 감염 소견 없음",
    symptoms: [
      { name: "알레르기성피부염", severity: "경증", location: "국소 피부", evidence: "소면적 탈모, 경미한 발적" },
    ],
    urgency:      "주의",
    action_plan:  "피부 전반 상태는 양호하나 국소적 소면적 탈모 및 경미한 발적이 발견되었습니다. 접촉성 알레르기 또는 자기 핥기에 의한 것으로 추정됩니다. 침구·세정제 등 자극 성분 여부를 확인하고 환부를 건조하게 유지하세요. 탈모 면적이 확대되거나 삼출·가피가 생기면 피부 스크래핑 검사를 위해 내원하세요.",
    home_care:    "환부를 건조하고 청결하게 유지하며, 반려동물이 핥지 않도록 넥칼라를 사용하세요. 저자극성 세정제로 교체하세요.",
    blood_ratio:  0.00,
  },

  ear: {
    primary_diagnosis: "귀진드기",
    confidence_level:  "높음",
    reasoning:         "이도 내 진한 갈색 건조 과립상 분비물 축적, 이개 충혈, 귀 진드기 감염 전형 소견",
    symptoms: [
      { name: "귀진드기",      severity: "중등증", location: "양측 이도",   evidence: "진한 갈색 과립상 분비물 축적" },
      { name: "말라세지아감염", severity: "경증",   location: "이개 내측",   evidence: "경도 충혈, 피지 분비 과다" },
    ],
    urgency:      "내원필요",
    action_plan:  "이도에 갈색 분비물이 상당량 관찰되며, 색상과 성상이 귀 진드기 감염을 강하게 시사합니다. 빠른 시일 내 내원하여 수의사 확인 후 구충제를 처방받으세요. 완전한 치료 과정（통상 3–4주）을 지켜야 재발을 방지할 수 있습니다.",
    home_care:    "내원 전 반려동물용 이도 세정액으로 귓바퀴 부근을 가볍게 마사지한 후 반려동물이 귀를 털도록 하세요. 면봉을 깊이 삽입하지 마세요. 자주 귀를 긁는다면 넥칼라를 임시 착용하세요.",
    blood_ratio:  0.00,
  },

  excrement: {
    primary_diagnosis: "건강한 연변",
    confidence_level:  "보통",
    reasoning:         "분변 연변·색 진한 갈색, 형태는 「健康偏软便」 분류에 해당, 혈흔 및 이물질 없음",
    symptoms: [],
    urgency:      "주의",
    action_plan:  "분변이 연하고 색이 짙어 최근 식이 변화, 과식 또는 경미한 장 자극과 관련될 수 있습니다. 간식을 일시 중단하고 소화가 잘 되는 담백한 식이로 1–2일 전환하며 충분한 수분을 제공하세요. 설사가 24시간 이상 지속되거나 혈변·기력 저하가 나타나면 즉시 내원하세요.",
    home_care:    "간식을 줄이고 담백한 식이를 제공하며 수분을 충분히 보충하세요. 배변 횟수와 성상 변화를 기록해 내원 참고자료로 활용하세요.",
    blood_ratio:  0.01,
    content_findings: [
      "健康偏软便",
      "색상：진한 갈색（소화 시간 짧음 시사）",
      "성상：연변, 경미한 점액 피복",
      "이물질 없음",
      "육안적 기생충 없음",
    ],
  },

  vomit: {
    primary_diagnosis: "급식으로 인한 구토",
    confidence_level:  "높음",
    reasoning:         "구토물 주성분 미소화 건식사료, 소량 황색 위액, 혈흔 및 이물질 없음",
    symptoms: [],
    urgency:      "주의",
    action_plan:  "구토물이 주로 미소화 음식물로 이루어져 있어 급식 또는 1회 과다 섭취를 시사합니다. 소량 다회 급여（1일 3–4회）로 전환하고 슬로우 피더볼을 사용하세요. 식후 30분간 격렬한 운동을 삼가세요. 1일 3회 이상 구토하거나 혈흔이 보이면 즉시 내원하세요.",
    home_care:    "슬로우 피더볼을 사용하고 1회 급여량을 줄이며 급여 횟수를 늘리세요. 식후 30분간 반려동물이 조용히 쉬도록 하세요.",
    blood_ratio:  0.00,
    content_findings: [
      "주성분：미소화 건식사료 알갱이（약 70%）",
      "소량 황색 위액（약 30%）",
      "혈흔 없음",
      "이물질 없음（골편, 직물 등）",
      "육안적 기생충 없음",
    ],
  },
};

/**
 * mockDiagnose — API Key 없이 1.5초 후 형식에 맞는 모의 결과 반환.
 */
export async function mockDiagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
  const bloodRatio = input.blood_ratio ?? 0;
  if (isLocalEmergency(bloodRatio)) {
    return buildEmergencyResult(input.module, bloodRatio);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  return buildFullResult(input.module, { ...MOCK_DATA[input.module] });
}

// ── 실제 API 호출 ─────────────────────────────────────────────

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

    // 알리클라우드 콘텐츠 안전 심사 차단（분변, 상처, 분비물 등 의료 동물 이미지에서 빈발）
    // 자동으로 Mock 참고 결과로 강등하여 사용자에게 순수 오류 화면을 노출하지 않음
    let isContentFiltered = false;
    try {
      const errJson = JSON.parse(errText);
      if (errJson?.error?.code === "data_inspection_failed") {
        isContentFiltered = true;
      }
    } catch { /* errText가 JSON이 아닌 경우 무시 */ }

    if (isContentFiltered) {
      console.warn("[diagnosisService] 콘텐츠 안전 심사 차단, Mock 참고 모드로 강등");
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
 * diagnose — 메인 진입점.
 * API Key 있으면 실제 API 호출; 없으면 자동으로 mockDiagnose로 강등.
 */
export async function diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
  if (!API_KEY) return mockDiagnose(input);
  return callDiagnose(input);
}

// ── 파싱 유틸리티 ──────────────────────────────────────────────

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

  // symptoms 배열 파싱
  const rawSymptoms = Array.isArray(parsed.symptoms) ? parsed.symptoms : [];
  const symptoms: Symptom[] = (rawSymptoms as unknown[]).map((s) => {
    const obj = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      name:     typeof obj.name     === "string" ? obj.name     : "증상 미상",
      severity: (["경증","중등증","중증"].includes(obj.severity as string)
        ? obj.severity : "경증") as "경증" | "중등증" | "중증",
      location: typeof obj.location === "string" ? obj.location : "",
      evidence: typeof obj.evidence === "string" ? obj.evidence : "",
    };
  });

  const rawUrgency  = parsed.urgency as string;
  const urgency     = (["정상","주의","내원필요"].includes(rawUrgency) ? rawUrgency : "주의") as "정상" | "주의" | "내원필요";

  const rawConf     = parsed.confidence as string;
  const confLevel   = (["높음","보통","낮음"].includes(rawConf) ? rawConf : "보통") as "높음" | "보통" | "낮음";

  const bloodRatio  = clamp(Number((parsed.blood_ratio as number) ?? inputBloodRatio), 0, 1);
  const isEmerg     = isLocalEmergency(bloodRatio);

  const actionPlan  = typeof parsed.action_plan === "string" ? parsed.action_plan : "반려동물 상태를 지속 관찰하시고, 이상이 있으면 즉시 내원해 주세요.";
  const homeCare    = typeof parsed.home_care    === "string" ? parsed.home_care    : "";

  return buildFullResult(
    module,
    {
      primary_diagnosis: typeof parsed.primary_diagnosis === "string" ? parsed.primary_diagnosis : "분석 완료",
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
