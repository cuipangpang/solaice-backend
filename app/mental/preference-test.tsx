import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useState, useEffect } from 'react'
import { localCache } from '@/utils/storage'
import { mentalService } from '@/services/mentalService'

// ─── 문항 데이터 ──────────────────────────────────────────────────

const QUESTIONS = [
  {
    q: '혼자 있을 때와 함께 있을 때 어느 쪽을 더 좋아하나요?',
    options: ['혼자 조용히', '가끔 함께', '자주 함께', '항상 함께'],
    dimension: 'social',
  },
  {
    q: '머리를 쓰다듬을 때 어떻게 반응하나요?',
    options: ['피해요', '그냥 있어요', '좋아해요', '아주 좋아해요'],
    dimension: 'touch',
  },
  {
    q: '낯선 소리에 어떻게 반응하나요?',
    options: ['무시해요', '잠깐 봐요', '많이 놀라요', '매우 예민해요'],
    dimension: 'env',
  },
  {
    q: '놀이 시간이 끝나면 어떻게 하나요?',
    options: ['바로 쉬어요', '조금 더 해요', '많이 더 해요', '멈추질 않아요'],
    dimension: 'game',
  },
  {
    q: '밥을 먹는 속도는 어느 쪽인가요?',
    options: ['매우 천천히', '보통이에요', '빨리 먹어요', '아주 빨리'],
    dimension: 'comfort',
  },
  {
    q: '낯선 사람을 만나면 어떻게 하나요?',
    options: ['숨어요', '거리를 둬요', '가까이 가요', '바로 친해져요'],
    dimension: 'social',
  },
  {
    q: '좋아하는 놀이 유형은 무엇인가요?',
    options: ['혼자 조용히', '간단한 장난감', '활발한 놀이', '사냥 놀이'],
    dimension: 'game',
  },
  {
    q: '배가 고플 때 어떻게 표현하나요?',
    options: ['조용히 기다려요', '살짝 알려요', '자주 알려요', '강하게 요구해요'],
    dimension: 'env',
  },
  {
    q: '무서울 때 어떻게 행동하나요?',
    options: ['혼자 숨어요', '그 자리에 있어요', '보호자 찾아요', '꼭 붙어있어요'],
    dimension: 'comfort',
  },
  {
    q: '가장 행복한 순간은 언제인가요?',
    options: ['혼자 자는 시간', '간식 먹을 때', '놀이할 때', '함께 있을 때'],
    dimension: 'happy',
  },
]

const DIMS = [
  { key: 'social',  label: '사교성' },
  { key: 'touch',   label: '스킨십' },
  { key: 'game',    label: '활동성' },
  { key: 'env',     label: '민감도' },
  { key: 'comfort', label: '안정감' },
  { key: 'happy',   label: '행복도' },
]

const OPT_VALS = [0.1, 0.4, 0.7, 1.0]

function computeScores(answers: number[]): Record<string, number> {
  const v = (idx: number) => OPT_VALS[answers[idx] ?? 0]
  return {
    social:  (v(0) + v(5)) / 2,
    touch:    v(1),
    env:     (v(2) + v(7)) / 2,
    game:    (v(3) + v(6)) / 2,
    comfort: (v(4) + v(8)) / 2,
    happy:    v(9),
  }
}

// ─────────────────────────────────────────────────────────────────

export default function PreferenceTestScreen() {
  const router    = useRouter()
  const [currentQ, setCurrentQ]   = useState(0)
  const [answers, setAnswers]     = useState<number[]>([])
  const [showResult, setShowResult] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [petId, setPetId]         = useState<string | null>(null)

  useEffect(() => {
    localCache.getPetId().then(setPetId)
  }, [])

  function handleOption(optionIdx: number) {
    const newAnswers = [...answers, optionIdx]
    setAnswers(newAnswers)
    setTimeout(() => {
      if (currentQ < QUESTIONS.length - 1) {
        setCurrentQ((q) => q + 1)
      } else {
        setShowResult(true)
      }
    }, 500)
  }

  function handleBack() {
    Alert.alert('테스트 종료', '진행 중인 테스트를 종료할까요?', [
      { text: '계속하기', style: 'cancel' },
      { text: '종료', style: 'destructive', onPress: () => router.back() },
    ])
  }

  async function handleComplete() {
    if (!petId) { router.back(); return }
    setSubmitting(true)
    try {
      await mentalService.logInteraction({
        pet_id: petId,
        interaction_type: 'playing',
        intensity: 'high',
        duration_seconds: 120,
        notes: 'preference_test',
        game_score: 20,
      })
      router.back()
    } catch {
      Alert.alert('오류', '결과 저장에 실패했어요.')
    } finally {
      setSubmitting(false)
    }
  }

  const progress = currentQ / QUESTIONS.length

  // ── 결과 화면 ──────────────────────────────────────────────────
  if (showResult) {
    const scores = computeScores(answers)
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.resultScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.resultTitle}>분석 완료</Text>
          <Text style={styles.resultSub}>반려동물의 성향을 분석했어요</Text>

          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>성향 분석 결과</Text>

          {DIMS.map((dim) => {
            const val = scores[dim.key] ?? 0
            const pct = Math.round(val * 100)
            return (
              <View key={dim.key} style={styles.dimRow}>
                <View style={styles.dimLeft}>
                  <Text style={styles.dimLabel}>{dim.label}</Text>
                </View>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.dimPct}>{pct}%</Text>
              </View>
            )
          })}

          <TouchableOpacity
            style={[styles.completeBtn, submitting && { opacity: 0.5 }]}
            onPress={handleComplete}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#2B3A55" />
            ) : (
              <Text style={styles.completeBtnText}>완료 (+8점)</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── 문항 화면 ──────────────────────────────────────────────────
  const q = QUESTIONS[currentQ]

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 & 진행 바 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.progressLabel}>Q {currentQ + 1} / {QUESTIONS.length}</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
      </View>

      {/* 문항 카드 */}
      <View style={styles.qCard}>
        <Text style={styles.qText}>{q.q}</Text>
      </View>

      {/* 선택지 */}
      <View style={styles.optionsWrap}>
        {q.options.map((opt, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.optBtn, answers[currentQ] === i && styles.optBtnSelected]}
            onPress={() => handleOption(i)}
            disabled={answers.length > currentQ}
          >
            <Text style={[styles.optText, answers[currentQ] === i && styles.optTextSelected]}>
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {submitting && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#BDE0FE" />
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: '#FAFCFF' },

  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backArrow:     { fontSize: 22, color: '#2B3A55' },
  progressLabel: { fontFamily: 'RobotoMono_400Regular', fontSize: 14, color: '#7A8DA3' },

  progressBarBg:   { height: 6, backgroundColor: '#E8EFF8', marginHorizontal: 20, borderRadius: 3, overflow: 'hidden', marginBottom: 24 },
  progressBarFill: { height: '100%', backgroundColor: '#BDE0FE', borderRadius: 3 },

  qCard:  { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 20, padding: 28, marginBottom: 24, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  qText:  { fontFamily: 'NotoSerifKR_700Bold', fontSize: 18, color: '#2B3A55', textAlign: 'center', lineHeight: 28 },

  optionsWrap: { paddingHorizontal: 20, gap: 10 },
  optBtn:     { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, borderWidth: 1.5, borderColor: '#E8EFF8', alignItems: 'center' },
  optBtnSelected: { borderColor: '#BDE0FE', backgroundColor: '#EAF6FF' },
  optText:        { fontFamily: 'Pretendard-Medium', fontSize: 15, color: '#7A8DA3' },
  optTextSelected:{ color: '#2B3A55', fontFamily: 'Pretendard-SemiBold' },

  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },

  // 결과 화면
  resultScroll: { padding: 24, paddingBottom: 48 },
  resultTitle:  { fontFamily: 'NotoSerifKR_700Bold', fontSize: 24, color: '#2B3A55', textAlign: 'center', marginBottom: 8 },
  resultSub:    { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#7A8DA3', textAlign: 'center', marginBottom: 20 },
  divider:      { height: 1, backgroundColor: '#E8EFF8', marginVertical: 16 },
  sectionLabel: { fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#2B3A55', marginBottom: 16 },

  dimRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dimLeft:   { flexDirection: 'row', alignItems: 'center', width: 80 },
  dimIcon:   { fontSize: 18, marginRight: 6 },
  dimLabel:  { fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#2B3A55' },
  barBg:     { flex: 1, height: 10, backgroundColor: '#E8EFF8', borderRadius: 5, overflow: 'hidden', marginHorizontal: 10 },
  barFill:   { height: '100%', backgroundColor: '#BDE0FE', borderRadius: 5 },
  dimPct:    { fontFamily: 'RobotoMono_400Regular', fontSize: 12, color: '#7A8DA3', width: 36, textAlign: 'right' },

  completeBtn:     { marginTop: 24, backgroundColor: '#BDE0FE', borderRadius: 16, height: 52, alignItems: 'center', justifyContent: 'center' },
  completeBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 16, color: '#2B3A55' },
})
