/**
 * app/translate/[petId].tsx — 펫 대화 화면
 *
 * 진입: router.push({ pathname: '/translate/[petId]', params: { petId } })
 * 탭 바 없음 (tabs 그룹 외부 → Stack으로 자동 처리)
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Audio } from 'expo-av'
import * as FileSystem from 'expo-file-system/legacy'
import ReAnimated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import type { Message, Pet } from '@/types/translate'
import { getPets, getMessages, addMessage, updateMessage } from '@/utils/translateStorage'
import { translatePetToHuman, translateHumanToPet } from '@/services/translateService'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'

// ── API ───────────────────────────────────────────────────────
const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

// ── 펫 사운드 맵 ──────────────────────────────────────────────
// Cat: mapped to actual files in assets/sounds/cat/
// Dog: no dog files yet — falls back to cat sounds temporarily
const SOUND_MAP: Record<string, any> = {
  // ── Pet Talk 키 (pet_to_human 방향) ───────────────────────
  cat_happy:   require('../../assets/sounds/cat/hello.mp3'),
  cat_love:    require('../../assets/sounds/cat/loveyou.mp3'),
  cat_anxious: require('../../assets/sounds/cat/comfort.mp3'),
  cat_angry:   require('../../assets/sounds/cat/angry.mp3'),
  cat_sad:     require('../../assets/sounds/cat/sorry.mp3'),
  cat_curious: require('../../assets/sounds/cat/what_are_you_doing.mp3'),
  cat_hungry:  require('../../assets/sounds/cat/hungry.mp3'),
  cat_sleepy:  require('../../assets/sounds/cat/sleep.mp3'),
  // ── You Talk 키 (human_to_pet 방향) ─────────────────────
  cat_affectionate: require('../../assets/sounds/cat/affectionate.mp3'),
  cat_cuddle:       require('../../assets/sounds/cat/cuddle.mp3'),
  cat_baby:         require('../../assets/sounds/cat/baby.mp3'),
  cat_hello:        require('../../assets/sounds/cat/hello.mp3'),
  cat_playful:      require('../../assets/sounds/cat/play_with_me.mp3'),
  cat_prey:         require('../../assets/sounds/cat/prey_on.mp3'),
  cat_feeding:      require('../../assets/sounds/cat/food_time.mp3'),
  cat_come:         require('../../assets/sounds/cat/come_here_quick.mp3'),
  cat_sleep:        require('../../assets/sounds/cat/sleep.mp3'),
  cat_no:           require('../../assets/sounds/cat/no.mp3'),
  cat_stop:         require('../../assets/sounds/cat/stop.mp3'),
  cat_scold:        require('../../assets/sounds/cat/hard_scold.mp3'),
  cat_sorry:        require('../../assets/sounds/cat/sorry.mp3'),
  cat_relax:        require('../../assets/sounds/cat/relax.mp3'),
  // cat_curious 는 Pet Talk 키와 공유
  // ── Dog 키 (dog 전용 파일 추가 전까지 cat fallback) ────────
  dog_happy:        require('../../assets/sounds/cat/hello.mp3'),
  dog_love:         require('../../assets/sounds/cat/loveyou.mp3'),
  dog_anxious:      require('../../assets/sounds/cat/comfort.mp3'),
  dog_angry:        require('../../assets/sounds/cat/angry.mp3'),
  dog_sad:          require('../../assets/sounds/cat/sorry.mp3'),
  dog_curious:      require('../../assets/sounds/cat/what_are_you_doing.mp3'),
  dog_hungry:       require('../../assets/sounds/cat/hungry.mp3'),
  dog_sleepy:       require('../../assets/sounds/cat/sleep.mp3'),
  dog_affectionate: require('../../assets/sounds/cat/affectionate.mp3'),
  dog_cuddle:       require('../../assets/sounds/cat/cuddle.mp3'),
  dog_baby:         require('../../assets/sounds/cat/baby.mp3'),
  dog_hello:        require('../../assets/sounds/cat/hello.mp3'),
  dog_playful:      require('../../assets/sounds/cat/play_with_me.mp3'),
  dog_prey:         require('../../assets/sounds/cat/prey_on.mp3'),
  dog_feeding:      require('../../assets/sounds/cat/food_time.mp3'),
  dog_come:         require('../../assets/sounds/cat/come_here_quick.mp3'),
  dog_sleep:        require('../../assets/sounds/cat/sleep.mp3'),
  dog_no:           require('../../assets/sounds/cat/no.mp3'),
  dog_stop:         require('../../assets/sounds/cat/stop.mp3'),
  dog_scold:        require('../../assets/sounds/cat/hard_scold.mp3'),
  dog_sorry:        require('../../assets/sounds/cat/sorry.mp3'),
  dog_relax:        require('../../assets/sounds/cat/relax.mp3'),
}

const playPetSound = async (petSoundKey: string) => {
  const source = SOUND_MAP[petSoundKey]
  if (!source) {
    console.warn('No sound file for key:', petSoundKey)
    return
  }
  try {
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true })
    const { sound } = await Audio.Sound.createAsync(source)
    await sound.playAsync()
    sound.setOnPlaybackStatusUpdate(status => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync()
      }
    })
  } catch (e) {
    console.error('Failed to play pet sound:', e)
  }
}

// ── 색상 ──────────────────────────────────────────────────────
const COLOR_BG = '#FAFCFF'
const COLOR_PRIMARY = '#2B3A55'
const COLOR_SECONDARY = '#7A8DA3'
const COLOR_BRAND = '#BDE0FE'
const COLOR_BUBBLE_PET = '#F0F4F8'
const COLOR_BUBBLE_HUMAN = '#BDE0FE'
const COLOR_BG_SECONDARY = '#EEF2F7'
const COLOR_BG_TERTIARY = '#D0DAE6'
const COLOR_DANGER = '#D32F2F'

// ── 빠른 문장 목록 ────────────────────────────────────────────
const QUICK_PHRASES = [
  '사랑해', '이리와', '안녕', '잘자',
  '밥 먹자', '착하다', '같이 놀자', '어디 있어?',
]

// ── 유틸 ──────────────────────────────────────────────────────
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── 로딩 점 애니메이션 ────────────────────────────────────────
function LoadingDots() {
  const op0 = useSharedValue(0.3)
  const op1 = useSharedValue(0.3)
  const op2 = useSharedValue(0.3)

  useEffect(() => {
    const delay = 200
    op0.value = withRepeat(
      withSequence(withTiming(1, { duration: 400 }), withTiming(0.3, { duration: 400 })),
      -1,
    )
    setTimeout(() => {
      op1.value = withRepeat(
        withSequence(withTiming(1, { duration: 400 }), withTiming(0.3, { duration: 400 })),
        -1,
      )
    }, delay)
    setTimeout(() => {
      op2.value = withRepeat(
        withSequence(withTiming(1, { duration: 400 }), withTiming(0.3, { duration: 400 })),
        -1,
      )
    }, delay * 2)
  }, [])

  const s0 = useAnimatedStyle(() => ({ opacity: op0.value }))
  const s1 = useAnimatedStyle(() => ({ opacity: op1.value }))
  const s2 = useAnimatedStyle(() => ({ opacity: op2.value }))

  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingVertical: 4 }}>
      <ReAnimated.View style={[styles.dot, s0]} />
      <ReAnimated.View style={[styles.dot, s1]} />
      <ReAnimated.View style={[styles.dot, s2]} />
    </View>
  )
}

// ── 파형 막대 (정적 시각화) ────────────────────────────────────
const WAVE_HEIGHTS = [10, 16, 22, 18, 12, 20, 14, 24, 16, 10]
function Waveform({ color = COLOR_SECONDARY }: { color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {WAVE_HEIGHTS.map((h, i) => (
        <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: color }} />
      ))}
    </View>
  )
}

// ── 오디오 플레이어 (공용) ────────────────────────────────────
function useAudioPlayer() {
  const soundRef = useRef<Audio.Sound | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)

  const play = useCallback(async (messageId: string, uri: string) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync()
        soundRef.current = null
        setPlayingId(null)
      }
      const { sound } = await Audio.Sound.createAsync({ uri })
      soundRef.current = sound
      setPlayingId(messageId)
      await sound.playAsync()
      sound.setOnPlaybackStatusUpdate(status => {
        if ('didJustFinish' in status && status.didJustFinish) {
          setPlayingId(null)
          sound.unloadAsync()
          soundRef.current = null
        }
      })
    } catch {
      setPlayingId(null)
    }
  }, [])

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync()
    }
  }, [])

  return { play, playingId }
}

// ── 메시지 버블 ───────────────────────────────────────────────
interface BubbleProps {
  message: Message
  petName: string
  petType: Pet['type']
  onPlay: (msgId: string, uri: string) => void
  isPlaying: boolean
}

function PetBubble({ message, petName, onPlay, isPlaying }: BubbleProps) {
  return (
    <View style={styles.rowLeft}>
      <View style={styles.bubblePet}>
        {message.isLoading ? (
          <LoadingDots />
        ) : (
          <>
            {message.originalAudioUri && (
              <TouchableOpacity
                style={styles.playRow}
                onPress={() => onPlay(message.id, message.originalAudioUri!)}
              >
                <Ionicons
                  name={isPlaying ? 'pause-circle' : 'play-circle'}
                  size={22}
                  color={COLOR_PRIMARY}
                />
                <Waveform />
              </TouchableOpacity>
            )}
            {message.translatedText ? (
              <Text style={styles.bubbleText}>{message.translatedText}</Text>
            ) : null}
          </>
        )}
        <Text style={styles.bubbleTime}>{formatTimestamp(message.timestamp)}</Text>
      </View>
    </View>
  )
}

function HumanBubble({ message, petType, onPlay, isPlaying }: BubbleProps) {
  const petLabel = petType === 'cat' ? '고양이어' : petType === 'dog' ? '강아지어' : '동물어'
  return (
    <View style={styles.rowRight}>
      <View style={styles.bubbleHuman}>
        {message.humanText ? (
          <Text style={[styles.bubbleText, { color: COLOR_PRIMARY }]}>{message.humanText}</Text>
        ) : null}
        {message.translatedText && (
          <View style={styles.petSoundRow}>
            <Text style={styles.petSoundLabel}>🐾 {petLabel} 버전</Text>
            {message.translatedText.startsWith('http') ? (
              <TouchableOpacity
                style={styles.playRowSmall}
                onPress={() => onPlay(message.id, message.translatedText!)}
              >
                <Ionicons
                  name={isPlaying ? 'pause-circle' : 'play-circle'}
                  size={20}
                  color={COLOR_PRIMARY}
                />
                <Waveform color={COLOR_PRIMARY} />
              </TouchableOpacity>
            ) : (
              <Text style={[styles.bubbleText, { color: COLOR_PRIMARY, marginTop: 2 }]}>
                {message.translatedText}
              </Text>
            )}
          </View>
        )}
        {message.petSoundKey && !message.isLoading && (
          <TouchableOpacity
            style={styles.replayBtn}
            onPress={() => playPetSound(message.petSoundKey!)}
            activeOpacity={0.7}
          >
            <Ionicons name="volume-medium-outline" size={13} color={COLOR_PRIMARY} />
            <Text style={styles.replayBtnText}>다시 듣기</Text>
          </TouchableOpacity>
        )}
        {message.isLoading && <LoadingDots />}
        <Text style={[styles.bubbleTime, { textAlign: 'right' }]}>
          {formatTimestamp(message.timestamp)}
        </Text>
      </View>
    </View>
  )
}

function MemoBubble({ message }: { message: Message }) {
  return (
    <View style={styles.rowCenter}>
      <View style={styles.bubbleMemo}>
        <Text style={styles.memoText}>{message.humanText}</Text>
        <Text style={styles.memoTime}>{formatTimestamp(message.timestamp)}</Text>
      </View>
    </View>
  )
}

// ── 메인 화면 ─────────────────────────────────────────────────
export default function PetConversationScreen() {
  const { petId } = useLocalSearchParams<{ petId: string }>()
  const router = useRouter()

  const [pet, setPet] = useState<Pet | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  // ── 번역 모드 상태 ────────────────────────────────────────
  const [activeMode, setActiveMode] = useState<'pet' | 'human'>('pet')
  const [humanText, setHumanText] = useState('')
  const [pendingAudioUri, setPendingAudioUri] = useState<string | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [humanInputPlaceholder, setHumanInputPlaceholder] = useState('반려동물에게 전할 말을 입력하세요')

  // ── 메모 모드 상태 ────────────────────────────────────────
  const [memoText, setMemoText] = useState('')

  // ── 녹음 훅 ──────────────────────────────────────────────
  const { startRecording, stopRecording, isRecording, duration } = useAudioRecorder()

  // ── Pet Talk 펄스 애니메이션 ──────────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (isRecording && activeMode === 'pet') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.35, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      ).start()
    } else {
      pulseAnim.stopAnimation()
      pulseAnim.setValue(1)
    }
  }, [isRecording, activeMode])

  // ── 오디오 재생 ───────────────────────────────────────────
  const { play, playingId } = useAudioPlayer()

  // ── 데이터 로드 ───────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      const pets = await getPets()
      const found = pets.find(p => p.id === petId)
      if (!found) { router.back(); return }
      setPet(found)
      const msgs = await getMessages(petId)
      setMessages(msgs)
    })()
  }, [petId])

  // ── 메시지 헬퍼 ───────────────────────────────────────────
  const appendMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg])
    addMessage(petId, msg)
  }, [petId])

  const patchMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))
    updateMessage(petId, id, updates)
  }, [petId])

  // ── Pet Talk 녹음 핸들러 ──────────────────────────────────
  const handlePetPressIn = async () => {
    await startRecording()
  }

  const handlePetPressOut = async () => {
    if (duration < 1) {
      await stopRecording()
      Alert.alert('', '너무 짧아요. 조금 더 길게 눌러주세요.')
      return
    }
    const uri = await stopRecording()
    if (uri) setPendingAudioUri(uri)
  }

  // ── You Talk 마이크 핸들러 (ASR) ────────────────────────────
  const handleHumanMicPressIn = async () => {
    setHumanText('')
    setHumanInputPlaceholder('듣는 중...')
    await startRecording()
  }

  const handleHumanMicPressOut = async () => {
    setHumanInputPlaceholder('반려동물에게 전할 말을 입력하세요')

    if (duration < 1) {
      await stopRecording()
      Alert.alert('', '너무 짧아요. 조금 더 길게 눌러주세요.')
      return
    }

    const uri = await stopRecording()
    if (!uri) return

    try {
      setIsTranscribing(true)
      const base64Audio = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' })
      const response = await fetch(`${BACKEND_URL}/translate/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: base64Audio, language: 'ko' }),
      })
      const data = await response.json()
      if (data.text) setHumanText(data.text)
    } catch (e) {
      Alert.alert('오류', '음성 인식에 실패했어요.')
    } finally {
      setIsTranscribing(false)
    }
  }

  // ── 펫 오디오 전송 ────────────────────────────────────────
  const sendPetAudio = useCallback(async (uri: string) => {
    if (!pet) return
    setIsTranslating(true)

    const msgId = genId()
    const loadingMsg: Message = {
      id: msgId,
      type: 'pet_to_human',
      originalAudioUri: uri,
      timestamp: new Date().toISOString(),
      isLoading: true,
    }
    appendMessage(loadingMsg)

    try {
      console.log('Preparing to send audio URI:', uri)
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      })
      console.log('Audio base64 length:', base64.length)
      const result = await translatePetToHuman(base64, pet.type, pet.name)
      patchMessage(msgId, {
        translatedText: result.translated_text,
        petSoundKey: result.pet_sound_key,
        isLoading: false,
      })
    } catch (e: any) {
      console.error('Translation Error Details:', e)
      Alert.alert(
        '번역 실패',
        e?.message === 'NETWORK_ERROR'
          ? '서버에 연결할 수 없습니다. 네트워크를 확인해주세요.'
          : '번역 중 오류가 발생했습니다. 다시 시도해주세요.',
      )
      setMessages(prev => prev.filter(m => m.id !== msgId))
    } finally {
      setIsTranslating(false)
    }
  }, [pet, appendMessage, patchMessage])

  // ── 인간 텍스트 전송 ──────────────────────────────────────
  const sendHumanText = useCallback(async (text: string) => {
    if (!pet) return
    setIsTranslating(true)

    const msgId = genId()
    const msg: Message = {
      id: msgId,
      type: 'human_to_pet',
      humanText: text,
      timestamp: new Date().toISOString(),
      isLoading: true,
    }
    appendMessage(msg)

    try {
      const result = await translateHumanToPet(text, pet.type)
      console.log('[YouTalk] pet_sound_key:', result.pet_sound_key, '| emotion:', result.emotion_label)
      patchMessage(msgId, {
        translatedText: result.sound_url || result.emotion_label,
        petSoundKey: result.pet_sound_key,
        isLoading: false,
      })
      await playPetSound(result.pet_sound_key)
    } catch (e: any) {
      Alert.alert(
        '번역 실패',
        e?.message === 'NETWORK_ERROR'
          ? '서버에 연결할 수 없습니다.'
          : '번역 중 오류가 발생했습니다.',
      )
      setMessages(prev => prev.filter(m => m.id !== msgId))
    } finally {
      setIsTranslating(false)
    }
  }, [pet, appendMessage, patchMessage])

  // ── 번역 버튼 핸들러 ──────────────────────────────────────
  const handleTranslate = async () => {
    if (activeMode === 'pet') {
      if (!pendingAudioUri) return
      await sendPetAudio(pendingAudioUri)
      setPendingAudioUri(null)
    } else {
      if (!humanText.trim()) return
      await sendHumanText(humanText.trim())
      setHumanText('')
    }
  }

  // ── 메모 전송 ─────────────────────────────────────────────
  const sendMemo = useCallback(async () => {
    if (!memoText.trim()) return
    const text = memoText.trim()
    setMemoText('')
    appendMessage({
      id: genId(),
      type: 'memo',
      humanText: text,
      timestamp: new Date().toISOString(),
    })
  }, [memoText, appendMessage])

  // ── 렌더 아이템 ───────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: Message }) => {
    if (!pet) return null
    const isPlaying = playingId === item.id
    if (item.type === 'memo') return <MemoBubble message={item} />
    if (item.type === 'pet_to_human') {
      return (
        <PetBubble
          message={item}
          petName={pet.name}
          petType={pet.type}
          onPlay={play}
          isPlaying={isPlaying}
        />
      )
    }
    return (
      <HumanBubble
        message={item}
        petName={pet.name}
        petType={pet.type}
        onPlay={play}
        isPlaying={isPlaying}
      />
    )
  }, [pet, playingId, play])

  if (!pet) return null

  const petEmoji = pet.type === 'cat' ? '🐱' : pet.type === 'dog' ? '🐶' : '🐾'

  // ── 번역 버튼 비활성화 조건 ───────────────────────────────
  const isTranslateDisabled =
    isTranslating ||
    isRecording ||
    isTranscribing ||
    (activeMode === 'pet' && !pendingAudioUri) ||
    (activeMode === 'human' && !humanText.trim())

  // ── JSX ───────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>

          {/* ── 헤더 ─────────────────────────────────────── */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={26} color={COLOR_PRIMARY} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <View style={styles.headerAvatar}>
                {pet.avatarUri ? (
                  <Image source={{ uri: pet.avatarUri }} style={styles.headerAvatarImg} />
                ) : (
                  <Text style={{ fontSize: 22 }}>{petEmoji}</Text>
                )}
              </View>
              <View style={{ marginLeft: 10 }}>
                <Text style={styles.headerName}>{pet.name}</Text>
                <Text style={styles.headerMode}>
                  {pet.isMemoMode ? '📝 메모 모드' : '🔄 번역 모드'}
                </Text>
              </View>
            </View>
            <View style={{ width: 44 }} />
          </View>

          {/* ── 메시지 목록 ──────────────────────────────── */}
          <FlatList
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
          />

          {/* ── 하단 입력 영역 ────────────────────────────── */}
          {pet.isMemoMode ? (

            /* ── 메모 모드 ──────────────────────────────── */
            <View style={styles.memoBar}>
              <TextInput
                style={styles.memoInput}
                value={memoText}
                onChangeText={setMemoText}
                placeholder="메모를 입력하세요..."
                placeholderTextColor={COLOR_SECONDARY}
                multiline
                returnKeyType="send"
                onSubmitEditing={sendMemo}
              />
              <TouchableOpacity
                onPress={sendMemo}
                disabled={!memoText.trim()}
                style={[styles.sendBtn, !memoText.trim() && { opacity: 0.4 }]}
              >
                <Ionicons name="send" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

          ) : (

            /* ── 번역 모드 ──────────────────────────────── */
            <View style={styles.translatePanel}>

              {/* Mode Toggle */}
              <View style={styles.toggleContainer}>
                <TouchableOpacity
                  style={[styles.togglePill, activeMode === 'pet' && styles.togglePillActive]}
                  onPress={() => setActiveMode('pet')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.toggleLabel, activeMode === 'pet' && styles.toggleLabelActive]}>
                    🐾 Pet Talk
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.togglePill, activeMode === 'human' && styles.togglePillActive]}
                  onPress={() => setActiveMode('human')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.toggleLabel, activeMode === 'human' && styles.toggleLabelActive]}>
                    💬 You Talk
                  </Text>
                </TouchableOpacity>
              </View>

              {activeMode === 'pet' ? (

                /* ── Pet Talk 내용 ──────────────────────── */
                <View style={styles.petTalkContent}>
                  {!isRecording && !pendingAudioUri && (
                    <Text style={styles.petTalkHint}>길게 눌러 소리를 녹음하세요</Text>
                  )}
                  {pendingAudioUri && !isRecording && (
                    <Text style={styles.petTalkReady}>✓ 녹음 완료 — 번역 버튼을 누르세요</Text>
                  )}

                  {/* 펄스 링 + 마이크 버튼 */}
                  <View style={styles.micWrapper}>
                    <Animated.View
                      style={[
                        styles.pulseRing,
                        {
                          transform: [{ scale: pulseAnim }],
                          opacity: isRecording ? 0.35 : 0,
                        },
                      ]}
                    />
                    <TouchableOpacity
                      onPressIn={handlePetPressIn}
                      onPressOut={handlePetPressOut}
                      activeOpacity={0.8}
                      disabled={isTranslating}
                    >
                      <View style={[styles.bigMicBtn, isRecording && styles.bigMicBtnActive]}>
                        <Ionicons
                          name="mic"
                          size={32}
                          color="#fff"
                        />
                      </View>
                    </TouchableOpacity>
                  </View>

                  {isRecording && (
                    <Text style={styles.recDuration}>
                      녹음 중... {formatDuration(duration)}
                    </Text>
                  )}
                </View>

              ) : (

                /* ── You Talk 내용 ───────────────────────── */
                <View style={styles.youTalkContent}>
                  {/* 빠른 문장 칩 */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                  >
                    {QUICK_PHRASES.map(phrase => (
                      <TouchableOpacity
                        key={phrase}
                        style={styles.chip}
                        onPress={() => setHumanText(phrase)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.chipText}>{phrase}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* 텍스트 입력 행 */}
                  <View style={styles.textInputRow}>
                    {/* 마이크 (ASR) */}
                    <TouchableOpacity
                      onPressIn={handleHumanMicPressIn}
                      onPressOut={handleHumanMicPressOut}
                      style={[styles.smallMicBtn, (isRecording || isTranscribing) && styles.smallMicBtnActive]}
                      activeOpacity={0.8}
                      disabled={isTranscribing}
                    >
                      {isTranscribing
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Ionicons name="mic" size={18} color={(isRecording || isTranscribing) ? '#fff' : COLOR_PRIMARY} />
                      }
                    </TouchableOpacity>

                    <TextInput
                      style={styles.humanTextInput}
                      value={(isRecording || isTranscribing) ? '' : humanText}
                      onChangeText={setHumanText}
                      placeholder={humanInputPlaceholder}
                      placeholderTextColor={(isRecording || isTranscribing) ? COLOR_DANGER : COLOR_SECONDARY}
                      editable={!isRecording && !isTranscribing}
                      multiline
                    />

                    <TouchableOpacity
                      onPress={() => {
                        if (!humanText.trim() || isTranslating) return
                        handleTranslate()
                      }}
                      disabled={!humanText.trim() || isTranslating}
                      style={[styles.sendBtn, (!humanText.trim() || isTranslating) && { opacity: 0.4 }]}
                    >
                      <Ionicons name="send" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>

              )}

              {/* ── 번역 버튼 (Pet Talk 모드에서만) ─────────── */}
              {activeMode === 'pet' && (
                <TouchableOpacity
                  onPress={handleTranslate}
                  disabled={isTranslateDisabled}
                  activeOpacity={0.85}
                  style={[
                    styles.translateBtn,
                    isTranslateDisabled && styles.translateBtnDisabled,
                  ]}
                >
                  {isTranslating ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.translateBtnLabel}>
                      {activeMode === 'pet' ? '🐾 번역하기' : '💬 전달하기'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </>
  )
}

// ── 스타일 ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
  },

  // 헤더
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(43,58,85,0.12)',
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLOR_BRAND,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerAvatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerName: {
    fontSize: 16,
    fontFamily: 'Pretendard-SemiBold',
    color: COLOR_PRIMARY,
  },
  headerMode: {
    fontSize: 11,
    fontFamily: 'Pretendard-Regular',
    color: COLOR_SECONDARY,
    marginTop: 1,
  },

  // 메시지 목록
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },

  // 버블 행
  rowLeft: { flexDirection: 'row', justifyContent: 'flex-start' },
  rowRight: { flexDirection: 'row', justifyContent: 'flex-end' },
  rowCenter: { flexDirection: 'row', justifyContent: 'center' },

  // 펫 버블
  bubblePet: {
    maxWidth: '75%',
    backgroundColor: COLOR_BUBBLE_PET,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },

  // 인간 버블
  bubbleHuman: {
    maxWidth: '75%',
    backgroundColor: COLOR_BUBBLE_HUMAN,
    borderRadius: 16,
    borderTopRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },

  // 메모 버블
  bubbleMemo: {
    backgroundColor: 'rgba(122,141,163,0.12)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: 'center',
    maxWidth: '80%',
  },
  memoText: {
    fontSize: 13,
    fontFamily: 'Pretendard-Regular',
    color: COLOR_SECONDARY,
    textAlign: 'center',
  },
  memoTime: {
    fontSize: 10,
    color: COLOR_SECONDARY,
    marginTop: 2,
  },

  // 공용 버블 텍스트
  bubbleText: {
    fontSize: 14,
    fontFamily: 'Pretendard-Regular',
    color: COLOR_PRIMARY,
    lineHeight: 20,
  },
  bubbleTime: {
    fontSize: 10,
    color: COLOR_SECONDARY,
    marginTop: 2,
  },

  // 재생 행
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playRowSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },

  // 펫 사운드 섹션
  petSoundRow: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(43,58,85,0.15)',
    paddingTop: 6,
    gap: 4,
  },
  petSoundLabel: {
    fontSize: 11,
    fontFamily: 'Pretendard-Medium',
    color: COLOR_PRIMARY,
    opacity: 0.7,
  },

  // 점 (로딩)
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLOR_SECONDARY,
  },

  // ── 메모 모드 바 ──────────────────────────────────────────
  memoBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(43,58,85,0.12)',
    backgroundColor: '#fff',
    gap: 10,
  },
  memoInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 100,
    backgroundColor: COLOR_BUBBLE_PET,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Pretendard-Regular',
    color: COLOR_PRIMARY,
  },

  // 공용 전송 버튼
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLOR_PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── 번역 패널 (번역 모드 전체 컨테이너) ──────────────────
  translatePanel: {
    backgroundColor: '#fff',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(43,58,85,0.12)',
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
  },

  // Mode toggle
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: COLOR_BG_SECONDARY,
    borderRadius: 12,
    padding: 4,
    marginHorizontal: 16,
    marginTop: 12,
  },
  togglePill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  togglePillActive: {
    backgroundColor: COLOR_PRIMARY,
  },
  toggleLabel: {
    fontSize: 13,
    fontFamily: 'Pretendard-Medium',
    color: COLOR_SECONDARY,
  },
  toggleLabelActive: {
    color: '#fff',
  },

  // ── Pet Talk 내용 ─────────────────────────────────────────
  petTalkContent: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
    minHeight: 160,
    justifyContent: 'center',
  },
  petTalkHint: {
    fontSize: 13,
    fontFamily: 'Pretendard-Regular',
    color: COLOR_SECONDARY,
  },
  petTalkReady: {
    fontSize: 13,
    fontFamily: 'Pretendard-Medium',
    color: '#2E7D32',
  },
  micWrapper: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLOR_DANGER,
  },
  bigMicBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLOR_PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLOR_PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  bigMicBtnActive: {
    backgroundColor: COLOR_DANGER,
    shadowColor: COLOR_DANGER,
  },
  recDuration: {
    fontSize: 13,
    fontFamily: 'Pretendard-Medium',
    color: COLOR_DANGER,
  },

  // ── You Talk 내용 ─────────────────────────────────────────
  youTalkContent: {
    paddingTop: 10,
    gap: 8,
  },
  chipRow: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: COLOR_BG_SECONDARY,
    borderWidth: 1,
    borderColor: 'rgba(43,58,85,0.12)',
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Pretendard-Regular',
    color: COLOR_PRIMARY,
  },
  textInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    gap: 8,
  },
  smallMicBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLOR_BG_SECONDARY,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallMicBtnActive: {
    backgroundColor: COLOR_DANGER,
  },
  humanTextInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 80,
    backgroundColor: COLOR_BG_SECONDARY,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: 'Pretendard-Regular',
    color: COLOR_PRIMARY,
  },

  // ── 번역 버튼 ─────────────────────────────────────────────
  translateBtn: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    height: 52,
    borderRadius: 16,
    backgroundColor: COLOR_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  translateBtnDisabled: {
    backgroundColor: COLOR_BG_TERTIARY,
  },
  translateBtnLabel: {
    fontSize: 16,
    fontFamily: 'Pretendard-SemiBold',
    color: '#fff',
  },

  // 다시 듣기 버튼
  replayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(43,58,85,0.08)',
  },
  replayBtnText: {
    fontSize: 11,
    fontFamily: 'Pretendard-Regular',
    color: COLOR_PRIMARY,
  },
})
