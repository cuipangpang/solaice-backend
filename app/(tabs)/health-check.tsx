import {
  diagnose,
  type DiagnosisResult,
  type ModuleKey,
  type Symptom,
} from "@/services/diagnosisService";
import { healthRecordService } from "@/services/healthRecordService";
import { uploadImage } from "@/services/uploadService";
import { MODULE_PADDING, calculateROIWithPadding } from "@/utils/imageProcessor";
import { localCache } from "@/utils/storage";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ── 模块配置 ──────────────────────────────────────────────────

const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "skin",      label: "피부"   },
  { key: "oral",      label: "구강"   },
  { key: "ear",       label: "귀"     },
  { key: "eye",       label: "눈"     },
  { key: "excrement", label: "변"     },
  { key: "vomit",     label: "구토물" },
];

const EYE_STEPS = ["① 양안 전경", "② 왼눈 클로즈업", "③ 오른눈 클로즈업"] as const;

// ── 情绪温度计色系映射 ─────────────────────────────────────────

const URGENCY_CONFIG: Record<
  string,
  { bg: string; textPrimary: string; textSub: string; tagline: string; headline: string }
> = {
  正常: {
    bg:          "#90CAF9",
    textPrimary: "#1A3A5C",
    textSub:     "rgba(26,58,92,0.7)",
    tagline:     "당신은 정성스러운 반려동물 부모님이에요",
    headline:    "오늘 상태 양호",
  },
  注意: {
    bg:          "#FFE29F",
    textPrimary: "#5A4000",
    textSub:     "rgba(90,64,0,0.7)",
    tagline:     "일찍 발견할수록 훨씬 쉽게 해결할 수 있어요",
    headline:    "주의가 필요해요",
  },
  就医: {
    bg:          "#FFB5A7",
    textPrimary: "#5C1A0F",
    textSub:     "rgba(92,26,15,0.7)",
    tagline:     "제때 발견하셨어요, 아주 중요한 일이에요",
    headline:    "동물병원 방문을 권장합니다",
  },
};

// 严重程度 → 标签色
const SEVERITY_STYLE: Record<
  Symptom["severity"],
  { bg: string; text: string; border: string }
> = {
  轻度: { bg: "rgba(144,202,249,0.22)", text: "#1A3A5C",  border: "rgba(144,202,249,0.55)" },
  中度: { bg: "rgba(255,226,159,0.28)", text: "#5A4000",  border: "rgba(255,226,159,0.65)" },
  重度: { bg: "rgba(255,181,167,0.28)", text: "#5C1A0F",  border: "rgba(255,181,167,0.65)" },
};

// 置信度 → 标签文字
const CONF_LABEL: Record<string, string> = {
  高: "신뢰도 · 높음",
  中: "신뢰도 · 보통",
  低: "신뢰도 · 낮음  （재촬영 권장）",
};

// 紧急度中→英（保存到后端用）
const URGENCY_TO_EN: Record<string, string> = {
  正常: "normal", 注意: "caution", 就医: "visit", 紧急: "emergency",
};
// 置信度中→英
const CONFIDENCE_TO_EN: Record<string, string> = {
  高: "high", 中: "medium", 低: "low",
};

// ── 图片获取工具 ──────────────────────────────────────────────

type ImageAsset = { uri: string; width: number; height: number };

/** 相机拍照：申请权限 → 唤起相机 → 返回原始图片信息 */
async function getCameraAsset(): Promise<ImageAsset | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("카메라 권한 필요", "반려동물 사진 촬영을 위해 카메라 접근 권한이 필요해요");
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.8,
    allowsEditing: false,
  });
  if (result.canceled) return null;
  const a = result.assets[0];
  return { uri: a.uri, width: a.width, height: a.height };
}

/** 相册选择：申请权限 → 唤起相册 → 返回原始图片信息 */
async function getGalleryAsset(): Promise<ImageAsset | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("권한 부족", "시스템 설정에서 앨범 접근을 허용해주세요");
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
    allowsEditing: false,
  });
  if (result.canceled) return null;
  const a = result.assets[0];
  return { uri: a.uri, width: a.width, height: a.height };
}

/** ROI 智能裁切：将任意来源的图片裁切为模块专属区域 */
async function cropImageAsset(asset: ImageAsset, module: ModuleKey): Promise<string> {
  const mockBBox = {
    x: asset.width  * 0.2,
    y: asset.height * 0.2,
    width:  asset.width  * 0.6,
    height: asset.height * 0.6,
  };
  const roi = calculateROIWithPadding(
    mockBBox,
    MODULE_PADDING[module],
    { width: asset.width, height: asset.height },
  );
  const cropped = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ crop: { originX: roi.x, originY: roi.y, width: roi.width, height: roi.height } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );
  return cropped.uri;
}

// ── 主页面 ────────────────────────────────────────────────────

export default function HealthCheckScreen() {
  const router = useRouter();

  const [selectedModule, setSelectedModule] = useState<ModuleKey>("skin");
  const [previewUri,     setPreviewUri]     = useState<string | null>(null);
  const [eyeUris,        setEyeUris]        = useState<(string | null)[]>([null, null, null]);
  const [uploading,      setUploading]      = useState(false);
  const [diagnosing,     setDiagnosing]     = useState(false);
  const [result,         setResult]         = useState<DiagnosisResult | null>(null);
  const [showEmergency,  setShowEmergency]  = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [saved,          setSaved]          = useState(false);

  function handleSelectModule(key: ModuleKey) {
    setSelectedModule(key);
    setPreviewUri(null);
    setEyeUris([null, null, null]);
    setResult(null);
    setShowEmergency(false);
    setSaved(false);
  }

  // 普通模块：弹出来源菜单
  function handleSingleUpload() {
    Alert.alert(
      "이미지 소스 선택",
      undefined,
      [
        { text: "촬영",          onPress: () => executeSinglePick(getCameraAsset)  },
        { text: "앨범에서 선택",  onPress: () => executeSinglePick(getGalleryAsset) },
        { text: "취소", style: "cancel" },
      ],
    );
  }

  // 获取图片 → 裁切 → 诊断（用户选择来源后才显示 loading）
  async function executeSinglePick(getAsset: () => Promise<ImageAsset | null>) {
    setUploading(true);
    const asset = await getAsset();
    if (!asset) { setUploading(false); return; }
    const uri = await cropImageAsset(asset, selectedModule);
    setUploading(false);
    setPreviewUri(uri);
    await runDiagnosis([uri]);
  }

  // 眼部单步：弹出来源菜单
  function handleEyeStepUpload(stepIndex: number) {
    Alert.alert(
      "이미지 소스 선택",
      undefined,
      [
        { text: "촬영",          onPress: () => executeEyeStepPick(stepIndex, getCameraAsset)  },
        { text: "앨범에서 선택",  onPress: () => executeEyeStepPick(stepIndex, getGalleryAsset) },
        { text: "취소", style: "cancel" },
      ],
    );
  }

  // 获取眼部单步图片 → 裁切 → 存入对应位置
  async function executeEyeStepPick(
    stepIndex: number,
    getAsset: () => Promise<ImageAsset | null>,
  ) {
    setUploading(true);
    const asset = await getAsset();
    if (!asset) { setUploading(false); return; }
    const uri = await cropImageAsset(asset, "eye");
    setUploading(false);
    setEyeUris((prev) => {
      const next = [...prev];
      next[stepIndex] = uri;
      return next;
    });
    setResult(null);
  }

  async function handleEyeDiagnose() {
    const validUris = eyeUris.filter(Boolean) as string[];
    if (validUris.length < 3) return;
    await runDiagnosis(validUris);
  }

  async function runDiagnosis(imageUris: string[]) {
    setDiagnosing(true);
    setResult(null);
    try {
      const r = await diagnose({ module: selectedModule, imageUris });
      setResult(r);
      if (r.is_emergency) setShowEmergency(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("진단 실패", msg);
    } finally {
      setDiagnosing(false);
    }
  }

  function handleReset() {
    setResult(null);
    setPreviewUri(null);
    setEyeUris([null, null, null]);
    setShowEmergency(false);
    setSaved(false);
  }

  async function handleSaveToRecords() {
    if (!result) return;
    setSaving(true);
    try {
      // 1. 获取 petId
      const petId = await localCache.getPetId();
      if (!petId) {
        Alert.alert(
          "먼저 프로필을 만들어주세요",
          "기록 페이지에서 반려동물 정보를 입력해주세요",
          [
            { text: "기록으로 이동", onPress: () => router.push("/(tabs)/records") },
            { text: "취소", style: "cancel" },
          ],
        );
        return;
      }

      // 2. 尝试上传图片（失败静默跳过，不阻塞主流程）
      const imageUri = selectedModule === "eye" ? eyeUris[0] : previewUri;
      let imageUrl: string | null = null;
      if (imageUri) {
        imageUrl = await uploadImage(imageUri, "health-checks", petId);
      }

      // 3. 保存检测记录
      await healthRecordService.createHealthRecord({
        pet_id:           petId,
        module:           selectedModule,
        urgency:          URGENCY_TO_EN[result.urgency] ?? result.urgency,
        primary_diagnosis: result.primary_diagnosis,
        action_plan:      result.action_plan,
        confidence_level: CONFIDENCE_TO_EN[result.confidence_level] ?? result.confidence_level,
        symptoms:         result.symptoms as any[],
        image_url:        imageUrl,
        image_key:        null,
      });

      // 4. 成功提示
      setSaved(true);
      Alert.alert("저장됨", "검사 결과가 건강 기록에 저장되었습니다.");
    } catch (error) {
      Alert.alert("저장 실패", "네트워크를 확인 후 다시 시도하세요. 검사 결과에는 영향이 없습니다");
    } finally {
      setSaving(false);
    }
  }

  const eyeAllSelected  = eyeUris.every(Boolean);
  const currentModule   = MODULES.find((m) => m.key === selectedModule)!;
  const urgencyConf     = result ? (URGENCY_CONFIG[result.urgency] ?? URGENCY_CONFIG["注意"]) : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 页面标题 ──────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.title}>건강 검진</Text>
          <Text style={styles.sub}>검사할 부위를 선택해주세요</Text>
        </View>

        {/* ── 模块选择器 ────────────────────────────────────── */}
        <View style={styles.moduleGrid}>
          {MODULES.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.moduleChip, selectedModule === m.key && styles.moduleChipActive]}
              onPress={() => handleSelectModule(m.key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.moduleLabel, selectedModule === m.key && styles.moduleLabelActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 上传区 ────────────────────────────────────────── */}
        <View style={styles.uploadWrap}>
          {selectedModule === "eye" ? (
            <>
              {EYE_STEPS.map((label, i) => (
                <View key={i} style={styles.eyeRow}>
                  <TouchableOpacity
                    style={[styles.eyePickBtn, eyeUris[i] ? styles.eyePickBtnDone : null]}
                    onPress={() => handleEyeStepUpload(i)}
                    activeOpacity={0.75}
                    disabled={uploading}
                  >
                    <Text style={styles.eyePickLabel}>{eyeUris[i] ? "✓ 선택됨" : "탭하여 선택"}</Text>
                    <Text style={styles.eyeStepLabel}>{label}</Text>
                  </TouchableOpacity>
                  {eyeUris[i] && (
                    <Image source={{ uri: eyeUris[i]! }} style={styles.eyeThumb} />
                  )}
                </View>
              ))}
              <View style={styles.gap8} />
              <TouchableOpacity
                style={[styles.primaryBtn, (!eyeAllSelected || diagnosing) && styles.primaryBtnDisabled]}
                onPress={handleEyeDiagnose}
                disabled={!eyeAllSelected || diagnosing}
                activeOpacity={0.8}
              >
                {diagnosing
                  ? <ActivityIndicator size="small" color="#2B3A55" />
                  : <Text style={styles.primaryBtnText}>눈 분석 시작</Text>
                }
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, (uploading || diagnosing) && styles.primaryBtnDisabled]}
              onPress={handleSingleUpload}
              disabled={uploading || diagnosing}
              activeOpacity={0.8}
            >
              {uploading || diagnosing
                ? <ActivityIndicator size="small" color="#2B3A55" />
                : <Text style={styles.primaryBtnText}>{currentModule.label} 사진 업로드</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {/* ── 图片预览（非眼部）────────────────────────────── */}
        {previewUri && selectedModule !== "eye" && (
          <View style={styles.previewWrap}>
            <Text style={styles.previewLabel}>
              크롭됨 · {currentModule.label} · +{Math.round(MODULE_PADDING[selectedModule] * 100)}% 패딩
            </Text>
            <Image source={{ uri: previewUri }} style={styles.previewImage} />
          </View>
        )}

        {/* ── 分析中提示 ───────────────────────────────────── */}
        {diagnosing && (
          <View style={styles.diagnosingRow}>
            <ActivityIndicator size="small" color="#90CAF9" />
            <Text style={styles.diagnosingText}>AI가 분석 중입니다…</Text>
          </View>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/*  诊断结果区（渐进披露）                            */}
        {/* ══════════════════════════════════════════════════ */}
        {result && !diagnosing && urgencyConf && (
          <>
            {/* ── 内容安全过滤降级提示条 ────────────────────── */}
            {result.is_content_filtered && (
              <View style={styles.filteredBanner}>
                <Text style={styles.filteredBannerText}>
                  이 이미지가 콘텐츠 안전 심사에 걸렸습니다. 아래는 참고 결과이며, 더 선명한 사진으로 다시 시도해 보세요
                </Text>
              </View>
            )}

            {/* ── 第一层：情绪温度计主卡片 ──────────────────── */}
            <View style={[styles.primaryCard, { backgroundColor: urgencyConf.bg, shadowColor: urgencyConf.bg }]}>
              {/* 置信度 badge */}
              <View style={[styles.confBadge, { backgroundColor: "rgba(255,255,255,0.35)" }]}>
                <Text style={[styles.confBadgeText, { color: urgencyConf.textPrimary }]}>
                  {CONF_LABEL[result.confidence_level] ?? "신뢰도 · 보통"}
                </Text>
              </View>

              {/* 状态标签行 */}
              <Text style={[styles.primaryCardHeadline, { color: urgencyConf.textPrimary }]}>
                {urgencyConf.headline}
              </Text>

              {/* 主诊断名 */}
              <Text style={[styles.primaryDiagnosis, { color: urgencyConf.textPrimary }]}>
                {result.primary_diagnosis}
              </Text>

              {/* 情感文案 */}
              <Text style={[styles.tagline, { color: urgencyConf.textSub }]}>
                {urgencyConf.tagline}
              </Text>

              {/* 判断依据 */}
              {result.reasoning.length > 0 && (
                <View style={styles.reasoningWrap}>
                  <Text style={[styles.reasoningText, { color: urgencyConf.textSub }]}>
                    {result.reasoning}
                  </Text>
                </View>
              )}

              {/* 眼部不对称度（仅眼部模块） */}
              {result.asymmetry_score !== undefined && (
                <View style={styles.asymmetryRow}>
                  <Text style={[styles.asymmetryLabel, { color: urgencyConf.textSub }]}>좌우 대칭도</Text>
                  <Text style={[styles.asymmetryValue, { color: urgencyConf.textPrimary }]}>
                    {result.asymmetry_score <= 0.15
                      ? "대칭 양호"
                      : result.asymmetry_score <= 0.35
                      ? "경미한 비대칭"
                      : "현저한 비대칭"}
                    {"  "}
                    <Text style={styles.asymmetryMono}>
                      {(result.asymmetry_score * 100).toFixed(0)}%
                    </Text>
                  </Text>
                </View>
              )}
            </View>

            {/* ── 第二层：症状详情 ───────────────────────────── */}
            {result.symptoms.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>증상 상세</Text>
                {result.symptoms.map((s, i) => (
                  <SymptomCard key={i} symptom={s} />
                ))}
              </View>
            )}

            {/* ── 第二层：内容物分析（粪便/呕吐物）──────────── */}
            {result.content_findings && result.content_findings.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>내용물 분석</Text>
                <View style={styles.adviceCard}>
                  {result.content_findings.map((f, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={[styles.bulletText, i === 0 && styles.bulletTextBold]}>{f}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ── 第三层：行动建议 ───────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>행동 권고</Text>
              <View style={styles.adviceCard}>
                <Text style={styles.adviceCardText}>{result.action_plan}</Text>
              </View>
            </View>

            {/* ── 第三层：居家护理 ───────────────────────────── */}
            {result.home_care.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>가정 간호</Text>
                <View style={styles.adviceCard}>
                  <Text style={styles.adviceCardText}>{result.home_care}</Text>
                </View>
              </View>
            )}

            {/* ── 底部操作区 ─────────────────────────────────── */}
            <View style={styles.ctaWrap}>
              {/* 就医状态时额外显示"查找附近医院"次级按钮 */}
              {result.urgency === "就医" && (
                <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.8}>
                  <Text style={styles.secondaryBtnText}>근처 동물병원 찾기</Text>
                </TouchableOpacity>
              )}
              {/* 保存到档案 */}
              <TouchableOpacity
                style={[styles.primaryBtn, (saving || saved) && styles.primaryBtnDisabled]}
                onPress={handleSaveToRecords}
                disabled={saving || saved}
                activeOpacity={0.8}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#2B3A55" />
                  : <Text style={styles.primaryBtnText}>{saved ? "저장됨" : "기록에 저장"}</Text>
                }
              </TouchableOpacity>
              {/* 重新检测 */}
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleReset} activeOpacity={0.8}>
                <Text style={styles.secondaryBtnText}>다시 검사</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>

      {/* ── 紧急警告弹窗 ─────────────────────────────────────── */}
      <Modal
        transparent
        animationType="slide"
        visible={showEmergency}
        statusBarTranslucent
      >
        <View style={styles.emergencyBackdrop}>
          <View style={styles.emergencySheet}>
            <View style={styles.emergencyRedBar} />
            <Text style={styles.emergencyTitle}>이상 감지</Text>
            <Text style={styles.emergencyBody}>
              {result?.action_plan ?? "이미지에서 명백한 혈흔이 감지되었습니다. 즉시 가까운 동물병원 응급실을 방문하세요."}
            </Text>
            <Text style={styles.emergencyHomeCare}>
              {result?.home_care ?? "이동 중에는 반려동물을 안정시키고, 깨끗한 천으로 상처를 부드럽게 눌러주세요. 반려동물이 상처를 핥지 않도록 하세요."}
            </Text>
            <Pressable
              style={styles.emergencyPrimaryBtn}
              onPress={() => setShowEmergency(false)}
            >
              <Text style={styles.emergencyPrimaryBtnText}>근처 동물병원에 즉시 연락</Text>
            </Pressable>
            <Pressable
              style={styles.emergencyDismiss}
              onPress={() => setShowEmergency(false)}
            >
              <Text style={styles.emergencyDismissText}>알겠습니다, 나중에 처리할게요</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── 症状卡片组件 ───────────────────────────────────────────────

function SymptomCard({ symptom }: { symptom: Symptom }) {
  const sc = SEVERITY_STYLE[symptom.severity] ?? SEVERITY_STYLE["轻度"];
  return (
    <View style={styles.symptomCard}>
      <View style={styles.symptomCardHeader}>
        <Text style={styles.symptomName}>{symptom.name}</Text>
        <View style={[styles.severityTag, { backgroundColor: sc.bg, borderColor: sc.border }]}>
          <Text style={[styles.severityTagText, { color: sc.text }]}>{symptom.severity}</Text>
        </View>
      </View>
      {symptom.location.length > 0 && (
        <Text style={styles.symptomLocation}>{symptom.location}</Text>
      )}
      {symptom.evidence.length > 0 && (
        <Text style={styles.symptomEvidence}>{symptom.evidence}</Text>
      )}
    </View>
  );
}

// ── 样式 ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FAFCFF" },
  scroll:    { paddingTop: 8, alignItems: "center" },

  // ── 页面标题 ──────────────────────────────────────────────
  header: { width: "88%", marginBottom: 18 },
  title: {
    fontFamily: "NotoSerifKR_700Bold",
    fontSize:   24,
    color:      "#2B3A55",
    marginBottom: 4,
  },
  sub: { fontFamily: "Pretendard-Regular", fontSize: 13, color: "#7A8DA3" },

  // ── 模块选择器 ────────────────────────────────────────────
  moduleGrid: {
    width:          "88%",
    flexDirection:  "row",
    flexWrap:       "wrap",
    gap:            10,
    marginBottom:   20,
  },
  moduleChip: {
    width:           "30%",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius:    14,
    backgroundColor: "#FFFFFF",
    alignItems:      "center",
    borderWidth:     1,
    borderColor:     "#E8EFF6",
    shadowColor:     "#BDE0FE",
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.18,
    shadowRadius:    6,
    elevation:       2,
  },
  moduleChipActive: {
    borderColor:     "#90CAF9",
    backgroundColor: "rgba(144,202,249,0.12)",
  },
  moduleIcon:       { fontSize: 20, marginBottom: 4 },
  moduleLabel:      { fontFamily: "Pretendard-Medium", fontSize: 13, color: "#2B3A55" },
  moduleLabelActive:{ color: "#1A3A5C" },

  // ── 上传按钮 ──────────────────────────────────────────────
  uploadWrap: { width: "88%", marginBottom: 16 },

  primaryBtn: {
    width:           "100%",
    height:          56,
    borderRadius:    28,
    backgroundColor: "#BDE0FE",
    alignItems:      "center",
    justifyContent:  "center",
    shadowColor:     "#BDE0FE",
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.40,
    shadowRadius:    16,
    elevation:       4,
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: {
    fontFamily: "Pretendard-SemiBold",
    fontSize:   16,
    color:      "#2B3A55",
  },

  secondaryBtn: {
    width:           "100%",
    height:          48,
    borderRadius:    24,
    backgroundColor: "rgba(189,224,254,0.35)",
    alignItems:      "center",
    justifyContent:  "center",
    borderWidth:     0.5,
    borderColor:     "rgba(255,255,255,0.6)",
    marginBottom:    12,
  },
  secondaryBtnText: {
    fontFamily: "Pretendard-Medium",
    fontSize:   15,
    color:      "#2B3A55",
  },

  // 眼部三步
  eyeRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 12 },
  eyePickBtn: {
    flex:            1,
    paddingVertical: 14,
    borderRadius:    14,
    backgroundColor: "#FFFFFF",
    alignItems:      "center",
    borderWidth:     1,
    borderColor:     "#E8EFF6",
  },
  eyePickBtnDone:  { borderColor: "#90CAF9", backgroundColor: "rgba(144,202,249,0.08)" },
  eyePickLabel:    { fontFamily: "Pretendard-Medium", fontSize: 13, color: "#2B3A55" },
  eyeStepLabel:    { fontFamily: "RobotoMono_400Regular", fontSize: 11, color: "#7A8DA3", marginTop: 2 },
  eyeThumb:        { width: 56, height: 56, borderRadius: 10, resizeMode: "cover" },

  gap8: { height: 8 },

  // ── 图片预览 ──────────────────────────────────────────────
  previewWrap:  { width: "88%", marginBottom: 16, alignItems: "center" },
  previewLabel: { fontFamily: "Pretendard-Regular", fontSize: 12, color: "#7A8DA3", marginBottom: 8 },
  previewImage: { width: "100%", aspectRatio: 1, borderRadius: 16, resizeMode: "cover" },

  // ── 分析中提示 ────────────────────────────────────────────
  diagnosingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  diagnosingText:{ fontFamily: "Pretendard-Regular", fontSize: 13, color: "#7A8DA3" },

  // ── 情绪温度计主卡片 ──────────────────────────────────────
  primaryCard: {
    width:         "88%",
    borderRadius:  24,
    padding:       22,
    marginBottom:  20,
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.30,
    shadowRadius:  20,
    elevation:     6,
  },
  confBadge: {
    alignSelf:     "flex-start",
    borderRadius:  20,
    paddingHorizontal: 10,
    paddingVertical:   4,
    marginBottom:  12,
  },
  confBadgeText: {
    fontFamily: "RobotoMono_400Regular",
    fontSize:   11,
  },
  primaryCardHeadline: {
    fontFamily:   "Pretendard-SemiBold",
    fontSize:     13,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  primaryDiagnosis: {
    fontFamily:   "NotoSerifKR_700Bold",
    fontSize:     26,
    marginBottom: 8,
    lineHeight:   34,
  },
  tagline: {
    fontFamily:   "Pretendard-Regular",
    fontSize:     14,
    marginBottom: 14,
    lineHeight:   20,
  },
  reasoningWrap: {
    backgroundColor: "rgba(255,255,255,0.30)",
    borderRadius:    12,
    paddingHorizontal: 14,
    paddingVertical:   10,
    marginBottom:    10,
  },
  reasoningText: {
    fontFamily: "Pretendard-Regular",
    fontSize:   13,
    lineHeight: 19,
  },
  asymmetryRow: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginTop:      6,
    paddingTop:     10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.35)",
  },
  asymmetryLabel: { fontFamily: "Pretendard-Regular", fontSize: 12 },
  asymmetryValue: { fontFamily: "Pretendard-SemiBold", fontSize: 13 },
  asymmetryMono:  { fontFamily: "RobotoMono_400Regular", fontSize: 12 },

  // ── 分区标题 ──────────────────────────────────────────────
  section:      { width: "88%", marginBottom: 16 },
  sectionLabel: {
    fontFamily:   "Pretendard-Medium",
    fontSize:     12,
    color:        "#7A8DA3",
    marginBottom: 8,
    letterSpacing: 0.5,
  },

  // ── 症状卡片 ──────────────────────────────────────────────
  symptomCard: {
    backgroundColor: "#FFFFFF",
    borderRadius:    16,
    padding:         16,
    marginBottom:    10,
    shadowColor:     "#BDE0FE",
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.20,
    shadowRadius:    10,
    elevation:       3,
  },
  symptomCardHeader: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginBottom:   6,
  },
  symptomName: {
    fontFamily: "Pretendard-SemiBold",
    fontSize:   15,
    color:      "#2B3A55",
    flex:       1,
    marginRight: 8,
  },
  severityTag: {
    borderRadius:    20,
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderWidth:     1,
  },
  severityTagText: { fontFamily: "Pretendard-Medium", fontSize: 12 },
  symptomLocation: {
    fontFamily:   "Pretendard-Regular",
    fontSize:     13,
    color:        "#7A8DA3",
    marginBottom: 4,
  },
  symptomEvidence: {
    fontFamily: "Pretendard-Regular",
    fontSize:   12,
    color:      "#A0AFC0",
    lineHeight: 18,
  },

  // ── 行动建议 / 居家护理卡片 ───────────────────────────────
  adviceCard: {
    backgroundColor: "#FFFFFF",
    borderRadius:    18,
    padding:         18,
    shadowColor:     "#BDE0FE",
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.22,
    shadowRadius:    14,
    elevation:       3,
  },
  adviceCardIcon: { fontSize: 18, marginBottom: 8 },
  adviceCardText: {
    fontFamily: "Pretendard-Regular",
    fontSize:   14,
    color:      "#2B3A55",
    lineHeight: 22,
  },

  // 内容物列表
  bulletRow:      { flexDirection: "row", marginBottom: 6 },
  bulletDot:      { fontFamily: "Pretendard-Regular", fontSize: 14, color: "#7A8DA3", marginRight: 6, lineHeight: 22 },
  bulletText:     { fontFamily: "Pretendard-Regular", fontSize: 14, color: "#2B3A55", lineHeight: 22, flex: 1 },
  bulletTextBold: { fontFamily: "Pretendard-SemiBold" },

  // ── 底部操作区 ────────────────────────────────────────────
  ctaWrap: { width: "88%", marginTop: 8, marginBottom: 16 },

  // ── 紧急弹窗 ──────────────────────────────────────────────
  emergencyBackdrop: {
    flex:            1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent:  "flex-end",
  },
  emergencySheet: {
    backgroundColor:    "#FFFFFF",
    borderTopLeftRadius:  28,
    borderTopRightRadius: 28,
    paddingBottom:      40,
    paddingHorizontal:  24,
    overflow:           "hidden",
  },
  emergencyRedBar: {
    height:          6,
    backgroundColor: "#D32F2F",
    marginLeft:      -24,
    marginRight:     -24,
    marginBottom:    24,
  },
  emergencyTitle: {
    fontFamily:   "NotoSerifKR_700Bold",
    fontSize:     22,
    color:        "#D32F2F",
    marginBottom: 14,
  },
  emergencyBody: {
    fontFamily:   "Pretendard-Regular",
    fontSize:     16,
    color:        "#2B3A55",
    lineHeight:   24,
    marginBottom: 12,
  },
  emergencyHomeCare: {
    fontFamily:   "Pretendard-Regular",
    fontSize:     14,
    color:        "#7A8DA3",
    lineHeight:   22,
    marginBottom: 24,
  },
  emergencyPrimaryBtn: {
    width:           "100%",
    height:          56,
    borderRadius:    16,
    backgroundColor: "#D32F2F",
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    16,
    shadowColor:     "#D32F2F",
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.35,
    shadowRadius:    14,
    elevation:       5,
  },
  emergencyPrimaryBtnText: {
    fontFamily: "Pretendard-SemiBold",
    fontSize:   16,
    color:      "#FFFFFF",
  },
  emergencyDismiss: { alignItems: "center", paddingVertical: 8 },
  emergencyDismissText: {
    fontFamily: "Pretendard-Regular",
    fontSize:   14,
    color:      "#7A8DA3",
  },

  // ── 内容安全降级提示条 ────────────────────────────────────
  filteredBanner: {
    width:           "88%",
    backgroundColor: "rgba(255,226,159,0.45)",
    borderRadius:    12,
    paddingHorizontal: 14,
    paddingVertical:   10,
    marginBottom:    12,
    borderWidth:     1,
    borderColor:     "rgba(255,226,159,0.8)",
  },
  filteredBannerText: {
    fontFamily: "Pretendard-Regular",
    fontSize:   13,
    color:      "#5A4000",
    lineHeight: 19,
  },

  bottomPad: { height: 100 },
});
