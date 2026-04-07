import { mentalService } from '@/services/mentalService'
import { localCache } from '@/utils/storage'
import { Audio } from 'expo-av'
import { VideoView, useVideoPlayer } from 'expo-video'
import { useRouter } from 'expo-router'
import * as ScreenOrientation from 'expo-screen-orientation'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// ─── 데이터 ──────────────────────────────────────────────────────

const MUSIC_LIST = [
  {
    id: 'music_1',
    title: '고양이 힐링 음악',
    desc: '편안한 릴렉스 멜로디',
    source: require('../../assets/audio/cat_relax.mp3'),
  },
]

const VIDEO_LIST: {
  id: string
  title: string
  desc: string
  source: any
  thumbnail?: any
}[] = [
  {
    id: 'video_1',
    title: '고양이 영상 모음',
    desc: '귀여운 고양이들',
    source: require('../../assets/video/cat_collection.mp4'),
    thumbnail: require('../../assets/thumbnails/cat_collection.png'),
  },
  {
    id: 'video_2',
    title: '바다 힐링 영상',
    desc: '파도 소리와 함께',
    source: require('../../assets/video/cat_sea.mp4'),
    thumbnail: require('../../assets/thumbnails/cat_sea.png'),
  },
]

// ─── 유틸 ──────────────────────────────────────────────────────

const formatTime = (ms: number) => {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────

export default function MediaScreen() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'music' | 'video'>('music')
  const [petId, setPetId] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)

  // 음악 상태
  const [sound, setSound] = useState<Audio.Sound | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [isLoadingId, setIsLoadingId] = useState<string | null>(null)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)

  // 비디오 상태
  const [selectedVideo, setSelectedVideo] = useState<(typeof VIDEO_LIST)[0] | null>(null)
  const player = useVideoPlayer(null, (p) => { p.loop = true })

  useEffect(() => {
    if (selectedVideo) {
      player.replace(selectedVideo.source)
      player.play()
    }
  }, [selectedVideo])

  useEffect(() => {
    localCache.getPetId().then(setPetId)
  }, [])

  // 컴포넌트 언마운트 시 사운드 해제
  useEffect(() => {
    return () => {
      sound?.unloadAsync()
    }
  }, [sound])

  // ─── 음악 재생 ───────────────────────────────────────────────

  const toggleMusic = async (item: (typeof MUSIC_LIST)[0]) => {
    // 같은 곡: 일시정지/재생
    if (playingId === item.id && sound) {
      const status = await sound.getStatusAsync()
      if (status.isLoaded) {
        status.isPlaying ? await sound.pauseAsync() : await sound.playAsync()
      }
      return
    }

    // 이전 곡 정지
    if (sound) {
      await sound.stopAsync()
      await sound.unloadAsync()
      setSound(null)
      setPlayingId(null)
      setPositionMs(0)
      setDurationMs(0)
    }

    // 새 곡 로드
    setIsLoadingId(item.id)
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      })
      const { sound: newSound } = await Audio.Sound.createAsync(
        item.source,
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            setPositionMs(status.positionMillis)
            setDurationMs(status.durationMillis ?? 0)
            if (status.didJustFinish) {
              setPlayingId(null)
              setPositionMs(0)
            }
          }
        }
      )
      setSound(newSound)
      setPlayingId(item.id)
    } catch {
      Alert.alert('오류', '음악을 재생할 수 없어요')
    } finally {
      setIsLoadingId(null)
    }
  }

  // ─── 비디오 재생 ─────────────────────────────────────────────

  const openVideo = async (item: (typeof VIDEO_LIST)[0]) => {
    setSelectedVideo(item)
    await ScreenOrientation.unlockAsync()
  }

  const closeVideo = async () => {
    setSelectedVideo(null)
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
  }

  // ─── 완료 버튼 ───────────────────────────────────────────────

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
      Alert.alert('완료!', '+5점이 추가되었어요', [
        { text: '확인', onPress: () => router.back() },
      ])
    } catch {
      Alert.alert('오류', '다시 시도해 주세요')
    } finally {
      setCompleting(false)
    }
  }

  // ─── 렌더 ────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>반려동물 미디어</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* 탭 */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={styles.tab}
          onPress={() => setActiveTab('music')}
        >
          <Text style={[styles.tabText, activeTab === 'music' && styles.tabTextActive]}>
            음악
          </Text>
          {activeTab === 'music' && <View style={styles.tabLine} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tab}
          onPress={() => setActiveTab('video')}
        >
          <Text style={[styles.tabText, activeTab === 'video' && styles.tabTextActive]}>
            동영상
          </Text>
          {activeTab === 'video' && <View style={styles.tabLine} />}
        </TouchableOpacity>
      </View>

      {/* 목록 */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'music'
          ? MUSIC_LIST.map((item) => (
              <View key={item.id} style={styles.musicCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardDesc}>{item.desc}</Text>
                  {/* 재생 중 진행 바 */}
                  {playingId === item.id && (
                    <View style={{ marginTop: 8 }}>
                      <View style={styles.progressBg}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width:
                                durationMs > 0
                                  ? `${((positionMs / durationMs) * 100).toFixed(1)}%`
                                  : '0%',
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.timeText}>
                        {formatTime(positionMs)} / {formatTime(durationMs)}
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.playBtn}
                  onPress={() => toggleMusic(item)}
                >
                  {isLoadingId === item.id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : playingId === item.id ? (
                    <Text style={styles.playBtnIcon}>⏸</Text>
                  ) : (
                    <Text style={[styles.playBtnIcon, { fontSize: 18 }]}>▶</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))
          : VIDEO_LIST.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.videoCard}
                onPress={() => openVideo(item)}
                activeOpacity={0.85}
              >
                {/* 썸네일 영역 */}
                {item.thumbnail ? (
                  <ImageBackground
                    source={item.thumbnail}
                    style={{ height: 160, justifyContent: 'center', alignItems: 'center' }}
                    imageStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
                  >
                    <View style={{
                      ...StyleSheet.absoluteFillObject,
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      borderTopLeftRadius: 12,
                      borderTopRightRadius: 12,
                    }} />
                    <View style={{
                      width: 60, height: 60, borderRadius: 30,
                      backgroundColor: 'rgba(255,255,255,0.9)',
                      justifyContent: 'center', alignItems: 'center',
                    }}>
                      <Text style={{ fontSize: 24, color: '#1a1a2e', marginLeft: 4 }}>▶</Text>
                    </View>
                  </ImageBackground>
                ) : (
                  <View style={{
                    height: 160, backgroundColor: '#1a1a2e',
                    justifyContent: 'center', alignItems: 'center',
                    borderTopLeftRadius: 12, borderTopRightRadius: 12,
                  }}>
                    <View style={{
                      width: 60, height: 60, borderRadius: 30,
                      backgroundColor: 'rgba(255,255,255,0.15)',
                      justifyContent: 'center', alignItems: 'center',
                    }}>
                      <Text style={{ fontSize: 24, color: '#fff', marginLeft: 4 }}>▶</Text>
                    </View>
                  </View>
                )}
                {/* 정보 영역 */}
                <View style={styles.videoInfo}>
                  <View>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardDesc}>{item.desc}</Text>
                  </View>
                  <Text style={styles.landscapeHint}>가로로 보기 가능 ↔</Text>
                </View>
              </TouchableOpacity>
            ))}
      </ScrollView>

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

      {/* 비디오 전체화면 모달 */}
      <Modal
        visible={selectedVideo !== null}
        onRequestClose={closeVideo}
        animationType="fade"
        statusBarTranslucent
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {/* 닫기 버튼 */}
          <TouchableOpacity onPress={closeVideo} style={styles.closeBtn}>
            <Text style={{ color: '#fff', fontSize: 20 }}>✕</Text>
          </TouchableOpacity>

          {/* 가로 보기 안내 */}
          <Text style={styles.landscapeTip}>
            기기를 가로로 돌리면 전체화면으로 볼 수 있어요
          </Text>

          <VideoView
            player={player}
            style={{ flex: 1 }}
            contentFit="contain"
            nativeControls={false}
          />
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1a1a2e' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: { fontFamily: 'NotoSerifKR_700Bold', fontSize: 18, color: '#fff' },
  backArrow: { fontSize: 22, color: '#fff' },

  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 20,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabText: { fontFamily: 'Pretendard-Medium', fontSize: 15, color: 'rgba(255,255,255,0.4)' },
  tabTextActive: { color: '#BDE0FE', fontFamily: 'Pretendard-SemiBold' },
  tabLine: { height: 2, backgroundColor: '#BDE0FE', width: '60%', marginTop: 8, borderRadius: 1 },

  listContent: { padding: 16, paddingBottom: 110 },

  // 음악 카드
  musicCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#2B3A55' },
  cardDesc: { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#7A8DA3', marginTop: 2 },
  progressBg: { height: 3, backgroundColor: '#E8EFF6', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: '#BDE0FE', borderRadius: 2 },
  timeText: {
    fontFamily: 'RobotoMono_400Regular',
    fontSize: 11,
    color: '#7A8DA3',
    textAlign: 'right',
    marginTop: 3,
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#BDE0FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  playBtnIcon: { color: '#fff', fontSize: 20 },

  // 비디오 카드
  videoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  videoInfo: {
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  landscapeHint: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 11,
    color: '#BDE0FE',
  },

  // 하단 버튼
  bottomWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: 'rgba(26,26,46,0.95)',
  },
  completeBtn: {
    height: 56,
    backgroundColor: '#fff',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 16, color: '#2B3A55' },

  // 비디오 모달
  closeBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  landscapeTip: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    zIndex: 10,
  },
})
