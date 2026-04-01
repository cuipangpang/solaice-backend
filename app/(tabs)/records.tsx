import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { healthRecordService, type HealthRecord, type HealthStats } from '@/services/healthRecordService'
import { petService, type PetProfile } from '@/services/petService'
import { vaccineService, type VaccineRecord } from '@/services/vaccineService'
import { localCache } from '@/utils/storage'

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ── 常量 ───────────────────────────────────────────────────────

type ScreenState = 'loading' | 'error' | 'no-pet' | 'loaded'
type SpeciesKey = 'cat' | 'dog' | 'other'

const SPECIES_INFO: Record<SpeciesKey, { label: string; icon: string }> = {
  cat:   { label: '고양이', icon: '🐱' },
  dog:   { label: '강아지', icon: '🐶' },
  other: { label: '기타',   icon: '🐾' },
}

const URGENCY_LABEL: Record<string, string> = {
  normal: '정상', caution: '주의', visit: '병원', emergency: '긴급',
}
const URGENCY_BG: Record<string, string> = {
  normal: '#90CAF9', caution: '#FFE29F', visit: '#FFB5A7', emergency: '#D32F2F',
}
const URGENCY_TEXT: Record<string, string> = {
  normal: '#1A3A5C', caution: '#5A4000', visit: '#5C1A0F', emergency: '#FFFFFF',
}

// ── 主页面 ─────────────────────────────────────────────────────

export default function RecordsScreen() {
  const [state,   setState]   = useState<ScreenState>('loading')
  const [pet,     setPet]     = useState<PetProfile | null>(null)
  const [records, setRecords] = useState<HealthRecord[]>([])
  const [vaccines, setVaccines] = useState<VaccineRecord[]>([])
  const [stats,   setStats]   = useState<HealthStats | null>(null)
  const [showModal, setShowModal] = useState(false)

  // ── 表单状态 ─────────────────────────────────────────────────
  const [formName,    setFormName]    = useState('')
  const [formSpecies, setFormSpecies] = useState<SpeciesKey>('cat')
  const [formBreed,   setFormBreed]   = useState('')
  const [formAge,     setFormAge]     = useState('')
  const [formSaving,  setFormSaving]  = useState(false)

  // ── 数据加载 ─────────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      loadAll()
    }, []),
  )

  async function loadAll() {
    setState('loading')
    try {
      const petId = await localCache.getPetId()
      if (!petId) {
        setState('no-pet')
        return
      }

      const [petData, recordsData, vaccinesData, statsData] = await Promise.all([
        petService.getPet(petId),
        healthRecordService.getHealthRecords(petId),
        vaccineService.getVaccineRecords(petId),
        healthRecordService.getHealthStats(petId),
      ])

      setPet(petData)
      setRecords(recordsData)
      setVaccines(vaccinesData)
      setStats(statsData)
      setState('loaded')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('不存在') || msg.includes('NOT_FOUND') || msg.includes('HTTP 404')) {
        await localCache.clearPetId()
        setState('no-pet')
      } else {
        setState('error')
      }
    }
  }

  // ── 档案编辑 Modal ────────────────────────────────────────────

  function openEditModal() {
    setFormName(pet?.name ?? '')
    setFormSpecies(((pet?.species as SpeciesKey) in SPECIES_INFO ? pet!.species as SpeciesKey : 'cat') ?? 'cat')
    setFormBreed(pet?.breed ?? '')
    setFormAge(pet?.age_years != null ? String(pet.age_years) : '')
    setShowModal(true)
  }

  async function handleSavePet() {
    if (!formName.trim()) {
      Alert.alert('반려동물 이름을 입력해주세요')
      return
    }
    setFormSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        species: formSpecies,
        ...(formBreed.trim()             && { breed:     formBreed.trim() }),
        ...(formAge && !isNaN(parseFloat(formAge)) && { age_years: parseFloat(formAge) }),
      }
      const savedPet = pet
        ? await petService.updatePet(pet.id, payload)
        : await petService.createPet(payload)

      await localCache.savePetId(savedPet.id)
      setShowModal(false)
      await loadAll()
    } catch (err) {
      Alert.alert('저장 실패', err instanceof Error ? err.message : '잠시 후 다시 시도해주세요')
    } finally {
      setFormSaving(false)
    }
  }

  // ── 删除检测记录 ──────────────────────────────────────────────

  function confirmDeleteRecord(record: HealthRecord) {
    Alert.alert(
      '검사 기록 삭제',
      `이 ${record.module_label} 검사 기록을 삭제하시겠습니까? 삭제 후 복원할 수 없습니다`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => handleDeleteRecord(record.id),
        },
      ],
    )
  }

  async function handleDeleteRecord(id: string) {
    try {
      await healthRecordService.deleteHealthRecord(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
    } catch {
      Alert.alert('삭제 실패', '네트워크를 확인 후 다시 시도해주세요')
    }
  }

  // ── 生成就医报告 ──────────────────────────────────────────────

  async function handleGenerateReport() {
    const petId = await localCache.getPetId()
    if (!petId) {
      Alert.alert('반려동물 프로필을 찾을 수 없습니다', '먼저 반려동물 프로필을 만들어주세요')
      return
    }
    const now = new Date()
    const endDate = now.toISOString().split('T')[0]
    const start = new Date(now)
    start.setMonth(start.getMonth() - 3)
    const startDate = start.toISOString().split('T')[0]
    const url = `${API_BASE}/reports/generate?pet_id=${petId}&start_date=${startDate}&end_date=${endDate}`
    Linking.openURL(url)
  }

  // ── Loading / Error ───────────────────────────────────────────

  if (state === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#BDE0FE" />
          <Text style={styles.loadingText}>로딩 중…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorIcon}>😿</Text>
          <Text style={styles.errorText}>로드 실패, 네트워크 연결을 확인해주세요</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadAll}>
            <Text style={styles.retryBtnText}>탭하여 재시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── 主内容 ───────────────────────────────────────────────────

  const speciesKey = (pet?.species as SpeciesKey) in SPECIES_INFO
    ? (pet!.species as SpeciesKey)
    : 'other'

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 页面标题 ──────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.title}>기록</Text>
          {stats && stats.total > 0 && (
            <View style={styles.statsBadge}>
              <Text style={styles.statsBadgeText}>{stats.total}회 검사</Text>
            </View>
          )}
        </View>

        {state === 'no-pet' ? (
          /* ── 无档案引导 ─────────────────────────────────── */
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>🐾</Text>
            <Text style={styles.emptyTitle}>반려동물 프로필이 없습니다</Text>
            <Text style={styles.emptySub}>프로필을 만들면 검사 결과가 건강 타임라인에 자동으로 저장됩니다</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={openEditModal}>
              <Text style={styles.primaryBtnText}>반려동물 프로필 만들기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ── 宠物信息卡 ──────────────────────────────── */}
            <View style={styles.petCard}>
              <View style={styles.petCardLeft}>
                <View style={styles.petIconWrap}>
                  <Text style={styles.petSpeciesIcon}>{SPECIES_INFO[speciesKey].icon}</Text>
                </View>
                <View style={styles.petCardInfo}>
                  <Text style={styles.petName}>{pet!.name}</Text>
                  <Text style={styles.petMeta}>
                    {SPECIES_INFO[speciesKey].label}
                    {pet!.breed    ? `  ·  ${pet!.breed}`        : ''}
                    {pet!.age_years != null ? `  ·  ${pet!.age_years}살` : ''}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={styles.editBtn} onPress={openEditModal}>
                <Text style={styles.editBtnText}>편집</Text>
              </TouchableOpacity>
            </View>

            {/* ── 数据统计行 ──────────────────────────────── */}
            {stats && (
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{stats.total}</Text>
                  <Text style={styles.statLabel}>검사 횟수</Text>
                </View>
                <View style={[styles.statCard, styles.statCardMid]}>
                  <Text style={styles.statValue}>
                    {stats.last_check_at
                      ? new Date(stats.last_check_at).toLocaleDateString('ko-KR', {
                          month: 'numeric', day: 'numeric',
                        })
                      : '—'}
                  </Text>
                  <Text style={styles.statLabel}>최근 검사</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{vaccines.length}</Text>
                  <Text style={styles.statLabel}>백신 기록</Text>
                </View>
              </View>
            )}

            {/* ── 검사 기록 ────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>검사 기록</Text>
              {records.length === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>검사 기록이 없습니다. 검사를 완료하면 여기에 표시됩니다</Text>
                </View>
              ) : (
                records.slice(0, 10).map((r) => (
                  <View key={r.id} style={styles.recordCard}>
                    <View style={styles.recordCardTop}>
                      <Text style={styles.recordModule}>{r.module_label}</Text>
                      <View style={styles.recordCardTopRight}>
                        <View style={[
                          styles.urgencyBadge,
                          { backgroundColor: URGENCY_BG[r.urgency] ?? '#90CAF9' },
                        ]}>
                          <Text style={[
                            styles.urgencyBadgeText,
                            { color: URGENCY_TEXT[r.urgency] ?? '#1A3A5C' },
                          ]}>
                            {URGENCY_LABEL[r.urgency] ?? r.urgency}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => confirmDeleteRecord(r)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.deleteBtn}
                        >
                          <Ionicons name="trash-outline" size={16} color="#FFB5A7" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <Text style={styles.recordDiagnosis} numberOfLines={2}>
                      {r.primary_diagnosis}
                    </Text>
                    <Text style={styles.recordDate}>
                      {new Date(r.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {/* ── 백신 기록 ────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>백신 기록</Text>
              {vaccines.length === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>백신 기록이 없습니다</Text>
                </View>
              ) : (
                vaccines.map((v) => {
                  const isOverdue = !!v.next_due_at && new Date(v.next_due_at) < new Date()
                  return (
                    <View key={v.id} style={styles.vaccineCard}>
                      <Text style={styles.vaccineType}>{v.type}</Text>
                      <Text style={styles.vaccineDates}>
                        접종일: {new Date(v.administered_at).toLocaleDateString('ko-KR', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </Text>
                      {v.next_due_at && (
                        <Text style={[styles.vaccineNext, isOverdue && styles.vaccineOverdue]}>
                          {isOverdue ? '⚠️  만료됨 · ' : '다음 접종: '}
                          {new Date(v.next_due_at).toLocaleDateString('ko-KR', {
                            year: 'numeric', month: 'short', day: 'numeric',
                          })}
                        </Text>
                      )}
                      {v.notes && (
                        <Text style={styles.vaccineNotes}>{v.notes}</Text>
                      )}
                    </View>
                  )
                })
              )}
            </View>
          </>
        )}

        {/* ── 生成就医报告 ──────────────────────────────────── */}
        {state === 'loaded' && (
          <TouchableOpacity style={styles.reportBtn} onPress={handleGenerateReport} activeOpacity={0.8}>
            <Text style={styles.reportBtnText}>📄 진료 보고서 생성</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>

      {/* ── 宠物档案编辑 Modal ─────────────────────────────────── */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !formSaving && setShowModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={styles.modalContainer}>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {/* Modal 标题行 */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{pet ? '프로필 편집' : '반려동물 프로필 만들기'}</Text>
                <TouchableOpacity
                  onPress={() => setShowModal(false)}
                  disabled={formSaving}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.modalClose}>취소</Text>
                </TouchableOpacity>
              </View>

              {/* 반려동물 이름 */}
              <Text style={styles.fieldLabel}>반려동물 이름 *</Text>
              <TextInput
                style={styles.textInput}
                value={formName}
                onChangeText={setFormName}
                placeholder="반려동물 이름을 입력하세요"
                placeholderTextColor="#A0AFC0"
                maxLength={20}
                returnKeyType="next"
              />

              {/* 종류 */}
              <Text style={styles.fieldLabel}>종류</Text>
              <View style={styles.speciesRow}>
                {(['cat', 'dog', 'other'] as SpeciesKey[]).map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.speciesBtn, formSpecies === s && styles.speciesBtnActive]}
                    onPress={() => setFormSpecies(s)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.speciesBtnIcon}>{SPECIES_INFO[s].icon}</Text>
                    <Text style={[
                      styles.speciesBtnLabel,
                      formSpecies === s && styles.speciesBtnLabelActive,
                    ]}>
                      {SPECIES_INFO[s].label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 품종 */}
              <Text style={styles.fieldLabel}>품종 (선택사항)</Text>
              <TextInput
                style={styles.textInput}
                value={formBreed}
                onChangeText={setFormBreed}
                placeholder="예: 영국 단모, 골든 리트리버"
                placeholderTextColor="#A0AFC0"
                maxLength={30}
                returnKeyType="next"
              />

              {/* 나이 */}
              <Text style={styles.fieldLabel}>나이 (선택사항)</Text>
              <TextInput
                style={styles.textInput}
                value={formAge}
                onChangeText={setFormAge}
                placeholder="세, 예: 2.5"
                placeholderTextColor="#A0AFC0"
                keyboardType="decimal-pad"
                maxLength={5}
                returnKeyType="done"
              />

              {/* 保存按钮 */}
              <TouchableOpacity
                style={[styles.saveBtn, formSaving && styles.saveBtnDisabled]}
                onPress={handleSavePet}
                disabled={formSaving}
                activeOpacity={0.8}
              >
                {formSaving
                  ? <ActivityIndicator size="small" color="#2B3A55" />
                  : <Text style={styles.saveBtnText}>프로필 저장</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

// ── 样式 ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFCFF' },
  scroll:    { paddingTop: 8, paddingHorizontal: 20 },

  // ── 页面标题 ──────────────────────────────────────────────
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   20,
  },
  title: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize:   28,
    color:      '#2B3A55',
  },
  statsBadge: {
    backgroundColor: 'rgba(144,202,249,0.20)',
    borderRadius:    20,
    paddingHorizontal: 12,
    paddingVertical:   4,
    borderWidth:     1,
    borderColor:     'rgba(144,202,249,0.45)',
  },
  statsBadgeText: {
    fontFamily: 'RobotoMono_400Regular',
    fontSize:   12,
    color:      '#1A3A5C',
  },

  // ── 中心对齐状态（loading / error）────────────────────────
  centered: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   14,
    color:      '#7A8DA3',
    marginTop:  12,
  },
  errorIcon: { fontSize: 40, marginBottom: 12 },
  errorText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   15,
    color:      '#7A8DA3',
    textAlign:  'center',
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: '#BDE0FE',
    borderRadius:    24,
    paddingHorizontal: 28,
    paddingVertical:   12,
  },
  retryBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   15,
    color:      '#2B3A55',
  },

  // ── 无档案引导 ────────────────────────────────────────────
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  emptyIcon:  { fontSize: 60, marginBottom: 16 },
  emptyTitle: {
    fontFamily:   'NotoSerifKR_700Bold',
    fontSize:     22,
    color:        '#2B3A55',
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   14,
    color:      '#7A8DA3',
    textAlign:  'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  primaryBtn: {
    backgroundColor: '#BDE0FE',
    borderRadius:    28,
    paddingHorizontal: 32,
    paddingVertical:   14,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.40,
    shadowRadius:    16,
    elevation:       4,
  },
  primaryBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   16,
    color:      '#2B3A55',
  },

  // ── 宠物信息卡 ────────────────────────────────────────────
  petCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    padding:         18,
    marginBottom:    16,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.25,
    shadowRadius:    14,
    elevation:       3,
  },
  petCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  petIconWrap: {
    width:          52,
    height:         52,
    borderRadius:   26,
    backgroundColor: 'rgba(189,224,254,0.25)',
    alignItems:     'center',
    justifyContent: 'center',
    marginRight:    12,
  },
  petSpeciesIcon: { fontSize: 28 },
  petCardInfo:    { flex: 1 },
  petName: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize:   20,
    color:      '#2B3A55',
    marginBottom: 2,
  },
  petMeta: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      '#7A8DA3',
  },
  editBtn: {
    backgroundColor: 'rgba(189,224,254,0.30)',
    borderRadius:    16,
    paddingHorizontal: 14,
    paddingVertical:   6,
    borderWidth:     1,
    borderColor:     'rgba(189,224,254,0.55)',
  },
  editBtnText: {
    fontFamily: 'Pretendard-Medium',
    fontSize:   13,
    color:      '#2B3A55',
  },

  // ── 统计行 ────────────────────────────────────────────────
  statsRow: {
    flexDirection:  'row',
    marginBottom:   20,
    gap:            10,
  },
  statCard: {
    flex:            1,
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    paddingVertical: 14,
    alignItems:      'center',
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.18,
    shadowRadius:    10,
    elevation:       2,
  },
  statCardMid: { marginHorizontal: 0 },
  statValue: {
    fontFamily:   'RobotoMono_400Regular',
    fontSize:     22,
    color:        '#2B3A55',
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   11,
    color:      '#7A8DA3',
  },

  // ── 分区 ──────────────────────────────────────────────────
  section:      { marginBottom: 20 },
  sectionTitle: {
    fontFamily:   'Pretendard-SemiBold',
    fontSize:     13,
    color:        '#7A8DA3',
    marginBottom: 10,
    letterSpacing: 0.5,
  },

  // ── 检测记录卡片 ──────────────────────────────────────────
  recordCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    padding:         16,
    marginBottom:    10,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.18,
    shadowRadius:    10,
    elevation:       2,
  },
  recordCardTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   6,
  },
  recordCardTopRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  deleteBtn: {
    padding: 2,
  },
  recordModule: {
    fontFamily: 'Pretendard-Medium',
    fontSize:   13,
    color:      '#7A8DA3',
  },
  urgencyBadge: {
    borderRadius:      20,
    paddingHorizontal: 10,
    paddingVertical:   3,
  },
  urgencyBadgeText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   12,
  },
  recordDiagnosis: {
    fontFamily:   'Pretendard-SemiBold',
    fontSize:     15,
    color:        '#2B3A55',
    marginBottom: 4,
    lineHeight:   22,
  },
  recordDate: {
    fontFamily: 'RobotoMono_400Regular',
    fontSize:   11,
    color:      '#A0AFC0',
  },

  // ── 疫苗记录卡片 ──────────────────────────────────────────
  vaccineCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    padding:         16,
    marginBottom:    10,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.18,
    shadowRadius:    10,
    elevation:       2,
  },
  vaccineType: {
    fontFamily:   'Pretendard-SemiBold',
    fontSize:     15,
    color:        '#2B3A55',
    marginBottom: 4,
  },
  vaccineDates: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      '#7A8DA3',
    marginBottom: 2,
  },
  vaccineNext: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      '#7A8DA3',
  },
  vaccineOverdue: { color: '#D32F2F' },
  vaccineNotes: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   12,
    color:      '#A0AFC0',
    marginTop:  4,
  },

  // ── 空状态 ────────────────────────────────────────────────
  emptySection: {
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    padding:         20,
    alignItems:      'center',
  },
  emptySectionText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      '#A0AFC0',
    textAlign:  'center',
    lineHeight: 20,
  },

  // ── 档案编辑 Modal ────────────────────────────────────────
  modalContainer: { flex: 1, backgroundColor: '#FAFCFF' },
  modalScroll:    { paddingHorizontal: 24, paddingBottom: 40 },
  modalHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingTop:     20,
    marginBottom:   28,
  },
  modalTitle: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize:   22,
    color:      '#2B3A55',
  },
  modalClose: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   16,
    color:      '#7A8DA3',
  },
  fieldLabel: {
    fontFamily:   'Pretendard-Medium',
    fontSize:     13,
    color:        '#7A8DA3',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     '#E8EFF6',
    paddingHorizontal: 16,
    paddingVertical:   14,
    fontFamily:      'Pretendard-Regular',
    fontSize:        15,
    color:           '#2B3A55',
    marginBottom:    20,
  },
  speciesRow: {
    flexDirection: 'row',
    gap:           10,
    marginBottom:  20,
  },
  speciesBtn: {
    flex:            1,
    paddingVertical: 14,
    borderRadius:    14,
    backgroundColor: '#FFFFFF',
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     '#E8EFF6',
  },
  speciesBtnActive: {
    borderColor:     '#90CAF9',
    backgroundColor: 'rgba(144,202,249,0.12)',
  },
  speciesBtnIcon:  { fontSize: 22, marginBottom: 4 },
  speciesBtnLabel: {
    fontFamily: 'Pretendard-Medium',
    fontSize:   13,
    color:      '#7A8DA3',
  },
  speciesBtnLabelActive: { color: '#1A3A5C' },
  saveBtn: {
    width:           '100%',
    height:          56,
    borderRadius:    28,
    backgroundColor: '#BDE0FE',
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       8,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.40,
    shadowRadius:    16,
    elevation:       4,
  },
  saveBtnDisabled: { opacity: 0.55 },
  saveBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   16,
    color:      '#2B3A55',
  },

  reportBtn: {
    backgroundColor: '#BDE0FE',
    borderRadius:    28,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       4,
    marginBottom:    16,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.35,
    shadowRadius:    12,
    elevation:       3,
  },
  reportBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   16,
    color:      '#2B3A55',
  },

  bottomPad: { height: 100 },
})
