import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated } from 'react-native'
import { localCache } from '@/utils/storage'
import { petService, type PetProfile } from '@/services/petService'
import {
  mentalService,
  type DiaryEntry,
  type InteractionCreate,
  type MentalProfile,
  MOOD_EMOJI,
  MOOD_LABEL,
} from '@/services/mentalService'

// ── 친밀도 게이지 (순수 View 원형) ────────────────────────────────
function IntimacyRing({ score }: { score: number }) {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(anim, {
      toValue: score / 100,
      duration: 800,
      useNativeDriver: false,
    }).start()
  }, [score])

  const size = 140
  const stroke = 12
  const inner = size - stroke * 2
  const color = score >= 70 ? '#BDE0FE' : score >= 40 ? '#FFE29F' : '#FFB5A7'

  return (
    <View style={[styles.ringWrap, { width: size, height: size }]}>
      <View style={[styles.ringOuter, { width: size, height: size, borderRadius: size / 2, borderColor: '#E8EFF8', borderWidth: stroke }]} />
      <Animated.View style={[styles.ringInner, { width: inner, height: inner, borderRadius: inner / 2, borderColor: color, borderWidth: stroke, opacity: anim }]} />
      <View style={styles.ringCenter}>
        <Text style={styles.ringScore}>{Math.round(score)}</Text>
        <Text style={styles.ringLabel}>친밀도</Text>
      </View>
    </View>
  )
}

// ── 상호작용 모달 ──────────────────────────────────────────────────
const INTERACTION_TYPES: { key: InteractionCreate['interaction_type']; label: string; emoji: string }[] = [
  { key: 'feeding',  label: '밥 주기',   emoji: '🍖' },
  { key: 'playing',  label: '놀아주기',  emoji: '🎾' },
  { key: 'grooming', label: '그루밍',    emoji: '✂️' },
  { key: 'cuddling', label: '안아주기',  emoji: '🤗' },
  { key: 'training', label: '훈련',      emoji: '🏆' },
  { key: 'walking',  label: '산책',      emoji: '🚶' },
]

// ─────────────────────────────────────────────────────────────────

export default function MentalHealthScreen() {
  const router = useRouter()

  const [pet, setPet]             = useState<PetProfile | null>(null)
  const [profile, setProfile]     = useState<MentalProfile | null>(null)
  const [diaries, setDiaries]     = useState<DiaryEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [logModal, setLogModal]   = useState(false)
  const [genDiary, setGenDiary]   = useState(false)
  const [logBusy, setLogBusy]     = useState(false)
  const [selectedType, setSelected] = useState<InteractionCreate['interaction_type']>('playing')
  const [notes, setNotes]         = useState('')

  // ── 데이터 로드 ─────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const petId = await localCache.getPetId()
      if (!petId) return
      const [petData, profileData, diaryData] = await Promise.all([
        petService.getPet(petId),
        mentalService.getProfile(petId),
        mentalService.getDiaries(petId, 3),
      ])
      setPet(petData)
      setProfile(profileData)
      setDiaries(diaryData)
    } catch (e) {
      console.error('[Mental] 로드 실패:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── 상호작용 로그 저장 ────────────────────────────────────────────
  async function handleLogInteraction() {
    if (!pet) return
    setLogBusy(true)
    try {
      const result = await mentalService.logInteraction({
        pet_id: pet.id,
        interaction_type: selectedType,
        intensity: 'medium',
        notes: notes || undefined,
      })
      setLogModal(false)
      setNotes('')
      Alert.alert('기록 완료!', `XP +${result.xp_gained}  친밀도 +${result.intimacy_gained}`)
      await loadAll()
    } catch (e) {
      Alert.alert('오류', '기록에 실패했어요. 다시 시도해주세요.')
    } finally {
      setLogBusy(false)
    }
  }

  // ── AI 일기 생성 ──────────────────────────────────────────────────
  async function handleGenerateDiary() {
    if (!pet) return
    setGenDiary(true)
    try {
      const diary = await mentalService.generateDiary(pet.id, pet.name, pet.species)
      setDiaries(prev => [diary, ...prev.slice(0, 2)])
      Alert.alert(`${pet.name}의 일기`, diary.content)
    } catch (e) {
      Alert.alert('오류', '일기 생성에 실패했어요.')
    } finally {
      setGenDiary(false)
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#BDE0FE" />
      </SafeAreaView>
    )
  }

  if (!pet) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>반려동물을 먼저 등록해주세요.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>돌아가기</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  const mood = profile?.mood_today ?? 'calm'
  const intimacy = Number(profile?.intimacy_score ?? 0)

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── 헤더 ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>정신 건강</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── 친밀도 카드 ────────────────────────────────────────── */}
        <View style={styles.intimacyCard}>
          <IntimacyRing score={intimacy} />
          <View style={styles.moodWrap}>
            <Text style={styles.moodEmoji}>{MOOD_EMOJI[mood] ?? '😌'}</Text>
            <Text style={styles.moodLabel}>{pet.name}(이)는 지금 {MOOD_LABEL[mood] ?? '평온해요'}</Text>
          </View>
        </View>

        {/* ── 스탯 행 ────────────────────────────────────────────── */}
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{profile?.total_interactions ?? 0}</Text>
            <Text style={styles.statLabel}>총 상호작용</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{profile?.games_played ?? 0}</Text>
            <Text style={styles.statLabel}>게임 횟수</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{Math.round(profile?.mental_health_score ?? 50)}</Text>
            <Text style={styles.statLabel}>심리 점수</Text>
          </View>
        </View>

        {/* ── 기능 입구 2×3 그리드 ──────────────────────────────────── */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setLogModal(true)}>
            <Text style={styles.actionEmoji}>💝</Text>
            <Text style={styles.actionLabel}>상호작용 기록</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/mental/games')}>
            <Text style={styles.actionEmoji}>🎮</Text>
            <Text style={styles.actionLabel}>게임 놀기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/mental/diary')}>
            <Text style={styles.actionEmoji}>📖</Text>
            <Text style={styles.actionLabel}>오늘 일기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/mental/media')}>
            <Text style={styles.actionEmoji}>🎵</Text>
            <Text style={styles.actionLabel}>음악·영상</Text>
            <Text style={styles.actionSub}>반려동물 미디어</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/mental/preference-test')}>
            <Text style={styles.actionEmoji}>🔍</Text>
            <Text style={styles.actionLabel}>성향 테스트</Text>
            <Text style={styles.actionSub}>10가지 성향 분석</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/mental/profile')}>
            <Text style={styles.actionEmoji}>🧠</Text>
            <Text style={styles.actionLabel}>심리 프로필</Text>
            <Text style={styles.actionSub}>6가지 특성 분석</Text>
          </TouchableOpacity>
        </View>

        {/* ── 최근 일기 ───────────────────────────────────────────── */}
        {diaries.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>최근 일기</Text>
            {diaries.map((d) => (
              <View key={d.id} style={styles.diaryCard}>
                <Text style={styles.diaryDate}>{d.date}</Text>
                <Text style={styles.diaryContent} numberOfLines={3}>{d.content}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── 상호작용 기록 모달 ──────────────────────────────────────── */}
      <Modal visible={logModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>상호작용 기록</Text>
            <View style={styles.typeGrid}>
              {INTERACTION_TYPES.map(({ key, label, emoji }) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.typeChip, selectedType === key && styles.typeChipActive]}
                  onPress={() => setSelected(key)}
                >
                  <Text style={styles.typeEmoji}>{emoji}</Text>
                  <Text style={[styles.typeLabel, selectedType === key && styles.typeLabelActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.notesInput}
              placeholder="메모 (선택)"
              placeholderTextColor="#7A8DA3"
              value={notes}
              onChangeText={setNotes}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setLogModal(false)}>
                <Text style={styles.cancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, logBusy && { opacity: 0.5 }]} onPress={handleLogInteraction} disabled={logBusy}>
                <Text style={styles.confirmText}>{logBusy ? '저장 중…' : '저장'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#FAFCFF' },
  center:      { flex: 1, backgroundColor: '#FAFCFF', alignItems: 'center', justifyContent: 'center' },
  scroll:      { padding: 20, paddingBottom: 48 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E8EFF8' },
  headerTitle: { fontFamily: 'NotoSerifKR_700Bold', fontSize: 18, color: '#2B3A55' },
  backArrow:   { fontSize: 22, color: '#2B3A55' },
  emptyText:   { fontFamily: 'Pretendard-Regular', fontSize: 16, color: '#7A8DA3', marginBottom: 20 },
  backBtn:     { backgroundColor: '#BDE0FE', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  backBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#2B3A55' },

  // 친밀도 카드
  intimacyCard: { backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  ringWrap:     { position: 'relative', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  ringOuter:    { position: 'absolute' },
  ringInner:    { position: 'absolute' },
  ringCenter:   { alignItems: 'center' },
  ringScore:    { fontFamily: 'RobotoMono_400Regular', fontSize: 32, color: '#2B3A55' },
  ringLabel:    { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#7A8DA3', marginTop: 2 },
  moodWrap:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moodEmoji:    { fontSize: 28 },
  moodLabel:    { fontFamily: 'Pretendard-Medium', fontSize: 15, color: '#2B3A55' },

  // 스탯
  statRow:   { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard:  { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  statNum:   { fontFamily: 'RobotoMono_400Regular', fontSize: 22, color: '#2B3A55' },
  statLabel: { fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#7A8DA3', marginTop: 4, textAlign: 'center' },

  // 기능 입구 그리드
  actionRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  actionBtn:   { width: '47%', backgroundColor: '#fff', borderRadius: 16, padding: 16, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  actionEmoji: { fontSize: 28, marginBottom: 6 },
  actionLabel: { fontFamily: 'Pretendard-Medium', fontSize: 12, color: '#2B3A55', textAlign: 'center' },
  actionSub:   { fontFamily: 'Pretendard-Regular', fontSize: 10, color: '#7A8DA3', textAlign: 'center', marginTop: 2 },

  // 일기
  section:      { marginTop: 4 },
  sectionTitle: { fontFamily: 'NotoSerifKR_700Bold', fontSize: 15, color: '#2B3A55', marginBottom: 12 },
  diaryCard:    { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  diaryDate:    { fontFamily: 'RobotoMono_400Regular', fontSize: 11, color: '#7A8DA3', marginBottom: 6 },
  diaryContent: { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#2B3A55', lineHeight: 22 },

  // 모달
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard:    { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle:   { fontFamily: 'NotoSerifKR_700Bold', fontSize: 17, color: '#2B3A55', marginBottom: 20, textAlign: 'center' },
  typeGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  typeChip:     { width: '30%', backgroundColor: '#F4F8FF', borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  typeChipActive: { borderColor: '#BDE0FE', backgroundColor: '#EAF6FF' },
  typeEmoji:    { fontSize: 22 },
  typeLabel:    { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#7A8DA3', marginTop: 4 },
  typeLabelActive: { color: '#2B3A55', fontFamily: 'Pretendard-SemiBold' },
  notesInput:   { backgroundColor: '#F4F8FF', borderRadius: 12, padding: 14, fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#2B3A55', marginBottom: 20 },
  modalBtns:    { flexDirection: 'row', gap: 12 },
  cancelBtn:    { flex: 1, backgroundColor: '#F4F8FF', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText:   { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#7A8DA3' },
  confirmBtn:   { flex: 1, backgroundColor: '#BDE0FE', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmText:  { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#2B3A55' },
})
