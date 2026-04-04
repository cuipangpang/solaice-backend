import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { localCache } from '@/utils/storage'
import { petService, type PetProfile } from '@/services/petService'
import { mentalService, type MentalProfile } from '@/services/mentalService'

// ─── 차원 구성 ────────────────────────────────────────────────────

const DIMENSIONS = [
  { key: 'social',  label: '사교성', icon: '👥', unlockLevel: 1, desc: '다른 사람·동물과 어울리기 좋아하는 정도' },
  { key: 'touch',   label: '스킨십', icon: '🤗', unlockLevel: 1, desc: '신체 접촉을 편안하게 받아들이는 정도' },
  { key: 'game',    label: '활동성', icon: '🎮', unlockLevel: 2, desc: '놀이·운동에 참여하고 싶어하는 정도' },
  { key: 'env',     label: '민감도', icon: '👂', unlockLevel: 3, desc: '환경 변화와 소리에 반응하는 민감도' },
  { key: 'comfort', label: '안정감', icon: '😌', unlockLevel: 4, desc: '스트레스 상황에서 회복하는 속도' },
  { key: 'happy',   label: '행복도', icon: '😊', unlockLevel: 5, desc: '전반적인 생활 만족도와 행복 지수' },
]

// 친밀도 점수 → 레벨 (1~6, 임계값 100점 단위)
function computeLevel(score: number): number {
  return Math.min(6, Math.floor(score / 100) + 1)
}

// 차원 값 도출 (저장된 preference 데이터 없이 mental profile에서 추론)
function deriveDimValues(profile: MentalProfile): Record<string, number> {
  const base = profile.mental_health_score / 100
  const intimacy = profile.intimacy_score / 100
  return {
    social:  Math.min(1, intimacy * 1.1),
    touch:   Math.min(1, intimacy * 0.9 + 0.1),
    game:    Math.min(1, (profile.games_played / 30) + 0.2),
    env:     Math.min(1, (1 - base) * 0.6 + 0.2),
    comfort: Math.min(1, base * 0.9 + 0.1),
    happy:   Math.min(1, (intimacy + base) / 2),
  }
}

// AI 요약 생성 (레벨 3 이상일 때)
function buildSummary(profile: MentalProfile, pet: PetProfile): string {
  const level = computeLevel(profile.intimacy_score)
  const mood  = profile.mood_today ?? 'calm'
  const moodKr: Record<string, string> = {
    happy: '행복하고', calm: '평온하며', anxious: '약간 예민하고',
    bored: '자극이 필요하며', excited: '활발하고', sad: '더 많은 관심이 필요한',
  }
  return (
    `${pet.name}(이)는 친밀도 ${Math.round(profile.intimacy_score)}점의 ` +
    `${moodKr[mood] || '평온하며'} 안정적인 성향을 가지고 있어요. ` +
    `총 ${profile.total_interactions}번의 상호작용과 ${profile.games_played}번의 게임을 통해 ` +
    `주인과 깊은 유대감을 쌓아왔습니다. ` +
    `레벨 ${level}에 도달한 ${pet.name}(은)는 더욱 풍부한 감정 표현이 가능한 상태예요.`
  )
}

// ─────────────────────────────────────────────────────────────────

export default function MentalProfileScreen() {
  const router = useRouter()
  const [pet, setPet]         = useState<PetProfile | null>(null)
  const [profile, setProfile] = useState<MentalProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const petId = await localCache.getPetId()
      if (!petId) { setLoading(false); return }
      const [petData, profileData] = await Promise.all([
        petService.getPet(petId),
        mentalService.getProfile(petId),
      ])
      setPet(petData)
      setProfile(profileData)
    } catch (e) {
      console.error('[MentalProfile] 로드 실패:', e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#BDE0FE" />
      </SafeAreaView>
    )
  }

  if (error || !pet || !profile) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>데이터를 불러오지 못했어요.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadData}>
          <Text style={styles.retryText}>다시 시도</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  const score         = profile.intimacy_score
  const level         = computeLevel(score)
  const nextThreshold = level * 100
  const nextDiff      = Math.max(0, nextThreshold - score)
  const dimValues     = deriveDimValues(profile)

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>심리 프로필</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* 반려동물 정보 카드 */}
        <View style={styles.petCard}>
          <View style={styles.avatar} />
          <Text style={styles.petName}>{pet.name}</Text>
          <Text style={styles.levelLabel}>레벨 {level} / 6</Text>
        </View>

        {/* 해금 진행 카드 */}
        <View style={styles.progressCard}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${Math.min(100, (score / 600) * 100)}%` }]} />
          </View>
          <Text style={styles.scoreLabel}>{Math.round(score)}점 / 600점</Text>
          {level < 6 && (
            <Text style={styles.nextLevelLabel}>다음 레벨까지 {Math.round(nextDiff)}점 남았어요</Text>
          )}
          {level >= 6 && (
            <Text style={styles.nextLevelLabel}>최고 레벨 달성! 🎉</Text>
          )}
          <View style={styles.dotRow}>
            {[1, 2, 3, 4, 5, 6].map((lv) => (
              <View key={lv} style={[styles.dot, lv <= level && styles.dotActive]} />
            ))}
          </View>
        </View>

        {/* 차원 카드들 */}
        {DIMENSIONS.map((dim) => {
          const locked = dim.unlockLevel > level
          const val    = dimValues[dim.key] ?? 0
          const pct    = Math.round(val * 100)
          return (
            <View key={dim.key} style={[styles.dimCard, locked && styles.dimCardLocked]}>
              {locked ? (
                <>
                  <Text style={styles.lockLabel}>🔒 레벨 {dim.unlockLevel} 해제</Text>
                  <Text style={styles.lockSub}>친밀도를 높여 잠금을 해제하세요</Text>
                </>
              ) : (
                <>
                  <View style={styles.dimHeader}>
                    <View style={styles.dimLeft}>
                      <Text style={styles.dimIcon}>{dim.icon}</Text>
                      <Text style={styles.dimLabel}>{dim.label}</Text>
                    </View>
                    <Text style={styles.dimPct}>{pct}%</Text>
                  </View>
                  <View style={styles.barBg}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.dimDesc}>{dim.desc}</Text>
                </>
              )}
            </View>
          )
        })}

        {/* AI 화상 요약 (레벨 3 이상) */}
        {level >= 3 && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>AI 분석 결과</Text>
            <Text style={styles.summaryText}>{buildSummary(profile, pet)}</Text>
          </View>
        )}

        {/* 하단 힌트 */}
        <Text style={styles.footerHint}>미션을 완료하면 레벨이 올라가요 🐾</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FAFCFF' },
  center: { flex: 1, backgroundColor: '#FAFCFF', alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { padding: 20, paddingBottom: 48 },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E8EFF8' },
  headerTitle: { fontFamily: 'NotoSerifKR_700Bold', fontSize: 18, color: '#2B3A55' },
  backArrow:   { fontSize: 22, color: '#2B3A55' },

  errorText: { fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#7A8DA3', marginBottom: 16 },
  retryBtn:  { backgroundColor: '#BDE0FE', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#2B3A55' },

  petCard:    { alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 24, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  avatar:     { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E8EFF8', marginBottom: 12 },
  petName:    { fontFamily: 'NotoSerifKR_700Bold', fontSize: 20, color: '#2B3A55', marginBottom: 4 },
  levelLabel: { fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#5BB3FF' },

  progressCard:    { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  progressBarBg:   { height: 10, backgroundColor: '#E8EFF8', borderRadius: 5, overflow: 'hidden', marginBottom: 8 },
  progressBarFill: { height: '100%', backgroundColor: '#BDE0FE', borderRadius: 5 },
  scoreLabel:      { fontFamily: 'RobotoMono_400Regular', fontSize: 13, color: '#2B3A55', marginBottom: 4 },
  nextLevelLabel:  { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#7A8DA3', marginBottom: 12 },
  dotRow:          { flexDirection: 'row', gap: 8 },
  dot:             { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E8EFF8' },
  dotActive:       { backgroundColor: '#BDE0FE' },

  dimCard:       { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  dimCardLocked: { backgroundColor: '#F4F8FF' },
  lockLabel:     { fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#B0BCC8', marginBottom: 4 },
  lockSub:       { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#C4D0DB' },
  dimHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dimLeft:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dimIcon:       { fontSize: 18 },
  dimLabel:      { fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#2B3A55' },
  dimPct:        { fontFamily: 'RobotoMono_400Regular', fontSize: 14, color: '#5BB3FF', fontWeight: '700' },
  barBg:         { height: 8, backgroundColor: '#E8EFF8', borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  barFill:       { height: '100%', backgroundColor: '#BDE0FE', borderRadius: 4 },
  dimDesc:       { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#7A8DA3' },

  summaryCard:  { backgroundColor: '#F3F0FF', borderRadius: 14, padding: 16, marginBottom: 16, marginTop: 4 },
  summaryTitle: { fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#7B5EA7', marginBottom: 8 },
  summaryText:  { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#2B3A55', lineHeight: 22 },

  footerHint: { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#B0BCC8', textAlign: 'center', marginTop: 8 },
})
