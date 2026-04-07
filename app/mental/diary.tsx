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
import { useCallback, useEffect, useState } from 'react'
import { localCache } from '@/utils/storage'
import { petService } from '@/services/petService'
import { mentalService, type DiaryEntry } from '@/services/mentalService'

// ─── 하이라이트 도출 ──────────────────────────────────────────────
// DiaryEntry에 highlights 필드가 없으므로, 콘텐츠 길이 기반으로 고정 항목 생성
function makeHighlights(entry: DiaryEntry): string[] {
  return [
    '주인과 함께하는 시간',
    '맛있는 밥과 간식',
    '포근한 안식처',
  ]
}

// ─────────────────────────────────────────────────────────────────

export default function DiaryScreen() {
  const router = useRouter()
  const todayStr = new Date().toISOString().split('T')[0]   // YYYY-MM-DD
  const today    = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

  const [entry, setEntry]         = useState<DiaryEntry | null>(null)
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)

  const loadTodayDiary = useCallback(async () => {
    setLoading(true)
    try {
      const petId = await localCache.getPetId()
      if (!petId) { setLoading(false); return }
      // getDiaries를 가져와서 오늘 날짜와 일치하는 항목 검색
      const diaries = await mentalService.getDiaries(petId, 20)
      const todayEntry = diaries.find((d) => d.date === todayStr) ?? null
      setEntry(todayEntry)
    } catch {
      setEntry(null)
    } finally {
      setLoading(false)
    }
  }, [todayStr])

  useEffect(() => { loadTodayDiary() }, [loadTodayDiary])

  async function handleGenerate() {
    setGenerating(true)
    try {
      const petId = await localCache.getPetId()
      if (!petId) return
      const pet    = await petService.getPet(petId)
      const result = await mentalService.generateDiary(petId, pet.name, pet.species)
      setEntry(result)
    } catch {
      Alert.alert('오류', '일기 생성에 실패했어요. 다시 시도해 주세요.')
    } finally {
      setGenerating(false)
    }
  }

  function handleShare() {
    Alert.alert('준비 중', '곧 업데이트될 예정이에요')
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>오늘의 일기</Text>
          <Text style={styles.headerDate}>{today}</Text>
        </View>
        <View style={{ width: 32 }} />
      </View>

      {/* 콘텐츠 영역 */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#BDE0FE" />
          <Text style={styles.loadingText}>일기를 불러오는 중...</Text>
        </View>
      ) : entry ? (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.diaryCard}>
              <Text style={styles.diaryContent}>{entry.content}</Text>

              <View style={styles.divider} />

              <Text style={styles.highlightTitle}>오늘의 하이라이트</Text>
              {makeHighlights(entry).map((h, i) => (
                <Text key={i} style={styles.highlightItem}>
                  <Text style={styles.highlightBullet}>·  </Text>{h}
                </Text>
              ))}
            </View>

            <View style={styles.badgeWrap}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>오늘 하루도 사랑받았어요</Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.bottomWrap}>
            <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
              <Text style={styles.shareBtnText}>공유하기</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={styles.emptyWrap}>
          {/* 심플한 반려동물 아이콘 (View 조합) */}
          <View style={styles.petIcon}>
            <View style={styles.petHead}>
              <View style={styles.petEar} />
              <View style={[styles.petEar, { right: 0, left: undefined }]} />
              <View style={styles.petFace}>
                <View style={styles.petEye} />
                <View style={[styles.petEye, { right: 24, left: undefined }]} />
                <View style={styles.petNose} />
              </View>
            </View>
          </View>

          <Text style={styles.emptyTitle}>오늘의 일기를 만들어볼까요?</Text>
          <Text style={styles.emptySub}>하루 동안의 소중한 순간을 기록해요</Text>

          <TouchableOpacity
            style={[styles.generateBtn, generating && { opacity: 0.5 }]}
            onPress={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator color="#2B3A55" />
            ) : (
              <Text style={styles.generateBtnText}>일기 만들기</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FAFCFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { padding: 16, paddingBottom: 80 },

  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E8EFF8' },
  headerCenter: { alignItems: 'center' },
  headerTitle:  { fontFamily: 'NotoSerifKR_700Bold', fontSize: 17, color: '#2B3A55' },
  headerDate:   { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#7A8DA3', marginTop: 2 },
  backArrow:    { fontSize: 22, color: '#2B3A55' },
  loadingText:  { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#7A8DA3' },

  diaryCard:    { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, elevation: 3 },
  diaryContent: { fontFamily: 'Pretendard-Regular', fontSize: 16, color: '#2B3A55', lineHeight: 28 },
  divider:      { height: 1, backgroundColor: '#E8EFF8', marginVertical: 16 },
  highlightTitle:{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#2B3A55', marginBottom: 10 },
  highlightItem: { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#7A8DA3', marginBottom: 6, lineHeight: 22 },
  highlightBullet:{ color: '#BDE0FE' },

  badgeWrap: { alignItems: 'center', marginTop: 4 },
  badge:     { backgroundColor: '#E6F9F0', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8 },
  badgeText: { fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#34A85A' },

  bottomWrap:   { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#FAFCFF', borderTopWidth: 1, borderTopColor: '#E8EFF8' },
  shareBtn:     { height: 52, backgroundColor: '#F4F8FF', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  shareBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#7A8DA3' },

  // 빈 상태
  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  // 반려동물 아이콘 (View 조합)
  petIcon:    { width: 110, height: 110, marginBottom: 28 },
  petHead:    { width: 90, height: 80, backgroundColor: '#E8EFF8', borderRadius: 40, alignSelf: 'center', position: 'relative', overflow: 'visible' },
  petEar:     { position: 'absolute', top: -18, left: 10, width: 28, height: 28, backgroundColor: '#E8EFF8', borderRadius: 14 },
  petFace:    { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  petEye:     { position: 'absolute', width: 10, height: 10, backgroundColor: '#2B3A55', borderRadius: 5, left: 22, top: 26 },
  petNose:    { position: 'absolute', width: 8, height: 6, backgroundColor: '#FFB5A7', borderRadius: 3, bottom: 20 },

  emptyTitle:   { fontFamily: 'NotoSerifKR_700Bold', fontSize: 18, color: '#2B3A55', textAlign: 'center', marginBottom: 10 },
  emptySub:     { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#7A8DA3', textAlign: 'center', marginBottom: 32 },
  generateBtn:  { width: '100%', height: 56, backgroundColor: '#BDE0FE', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  generateBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 17, color: '#2B3A55' },
})
