import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { localCache } from '@/utils/storage'
import { mentalService } from '@/services/mentalService'

// ─── 데이터 ──────────────────────────────────────────────────────

const MUSIC_LIST = [
  { id: '1', title: '고양이를 위한 클래식', desc: '낮은 주파수, 안정감',   duration: '30분', petType: 'cat' },
  { id: '2', title: '자연 소리 믹스',       desc: '새소리, 시냇물 소리',   duration: '45분', petType: 'cat' },
  { id: '3', title: '피아노 소나타',         desc: '느린 템포의 클래식',    duration: '20분', petType: 'cat' },
  { id: '4', title: '베토벤 교향곡',         desc: '클래식으로 안정감',     duration: '40분', petType: 'dog' },
  { id: '5', title: '재즈 멜로디',           desc: '부드러운 재즈 음악',    duration: '35분', petType: 'dog' },
]

const VIDEO_LIST = [
  { id: '1', title: '새 영상',        desc: '창밖의 새들 (고양이용)',       duration: '15분', petType: 'cat' },
  { id: '2', title: '다람쥐 동영상',  desc: '숲속 다람쥐 (파랑·노랑 계열)', duration: '10분', petType: 'cat' },
  { id: '3', title: '물고기 수족관',  desc: '색깔 물고기들',                duration: '20분', petType: 'cat' },
  { id: '4', title: '강아지 달리기',  desc: '야외 운동 영상',               duration: '12분', petType: 'dog' },
  { id: '5', title: '공놀이 영상',    desc: '함께 노는 강아지들',           duration: '8분',  petType: 'dog' },
]

type MediaItem = (typeof MUSIC_LIST)[0]

// ─────────────────────────────────────────────────────────────────

export default function MediaScreen() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'music' | 'video'>('music')
  const [petId, setPetId]         = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)

  useEffect(() => {
    localCache.getPetId().then(setPetId)
  }, [])

  async function handleComplete() {
    if (!petId) {
      Alert.alert('알림', '반려동물을 먼저 등록해주세요.')
      return
    }
    setCompleting(true)
    try {
      await mentalService.logInteraction({
        pet_id: petId,
        interaction_type: 'playing',
        intensity: 'medium',
        duration_seconds: 300,
        notes: 'media:music',
      })
      Alert.alert('완료!', '+5점이 추가되었어요 🎉', [
        { text: '확인', onPress: () => router.back() },
      ])
    } catch {
      Alert.alert('오류', '다시 시도해 주세요')
    } finally {
      setCompleting(false)
    }
  }

  const list = activeTab === 'music' ? MUSIC_LIST : VIDEO_LIST
  const actionLabel = activeTab === 'music' ? '재생하기' : '시청하기'
  const alertMsg    = activeTab === 'music' ? '음악 앱에서 재생해 주세요 🎵' : '영상 앱에서 시청해 주세요 📺'

  function renderItem({ item }: { item: MediaItem }) {
    return (
      <TouchableOpacity style={styles.card} onPress={() => Alert.alert('안내', alertMsg)}>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardDesc}>{item.desc}</Text>
          <View style={styles.pill}>
            <Text style={styles.pillText}>⏱ {item.duration}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.actionBtn} onPress={() => Alert.alert('안내', alertMsg)}>
          <Text style={styles.actionBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>반려동물 미디어</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* 탭 */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'music' && styles.tabActive]}
          onPress={() => setActiveTab('music')}
        >
          <Text style={[styles.tabText, activeTab === 'music' && styles.tabTextActive]}>🎵 음악</Text>
          {activeTab === 'music' && <View style={styles.tabLine} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'video' && styles.tabActive]}
          onPress={() => setActiveTab('video')}
        >
          <Text style={[styles.tabText, activeTab === 'video' && styles.tabTextActive]}>📺 동영상</Text>
          {activeTab === 'video' && <View style={styles.tabLine} />}
        </TouchableOpacity>
      </View>

      {/* 목록 */}
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* 완료 버튼 */}
      <View style={styles.bottomWrap}>
        <TouchableOpacity
          style={[styles.completeBtn, completing && { opacity: 0.5 }]}
          onPress={handleComplete}
          disabled={completing}
        >
          {completing ? (
            <ActivityIndicator color="#2B3A55" />
          ) : (
            <Text style={styles.completeBtnText}>오늘 미디어 감상 완료 (+5점)</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: '#1a1a2e' },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle: { fontFamily: 'NotoSerifKR_700Bold', fontSize: 18, color: '#fff' },
  backArrow:   { fontSize: 22, color: '#fff' },

  tabRow:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)', marginHorizontal: 20 },
  tab:           { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive:     {},
  tabText:       { fontFamily: 'Pretendard-Medium', fontSize: 15, color: 'rgba(255,255,255,0.4)' },
  tabTextActive: { color: '#BDE0FE', fontFamily: 'Pretendard-SemiBold' },
  tabLine:       { height: 2, backgroundColor: '#BDE0FE', width: '60%', marginTop: 8, borderRadius: 1 },

  listContent: { padding: 16, paddingBottom: 100 },

  card:      { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardInfo:  { flex: 1 },
  cardTitle: { fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#2B3A55', marginBottom: 3 },
  cardDesc:  { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#7A8DA3', marginBottom: 6 },
  pill:      { alignSelf: 'flex-start', backgroundColor: '#EAF6FF', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  pillText:  { fontFamily: 'RobotoMono_400Regular', fontSize: 11, color: '#5BB3FF' },

  actionBtn:     { backgroundColor: '#BDE0FE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginLeft: 10 },
  actionBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 12, color: '#2B3A55' },

  bottomWrap:      { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: 'rgba(26,26,46,0.95)' },
  completeBtn:     { height: 56, backgroundColor: '#fff', borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  completeBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 16, color: '#2B3A55' },
})
