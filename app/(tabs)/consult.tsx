/**
 * consult.tsx — 다중 턴 AI 반려동물 건강 상담 화면
 *
 * - useReducer 상태 관리
 * - SSE 스트리밍 메시지 (chatService.sendChatMessage)
 * - 진단 결과 카드 (urgency별 색상)
 * - 긴급 상황 전체 화면 Modal
 * - 이미지 첨부 + S3 업로드 (uploadService 재사용)
 * - AbortController로 전송 취소
 */

import { uploadImage } from '@/services/uploadService'
import {
  type ChatMessage,
  type DiagnosisResult,
  closeChatSession,
  createChatSession,
  sendChatMessage,
} from '@/services/chatService'
import { localCache } from '@/utils/storage'
import { petService, type PetProfile } from '@/services/petService'
import { startRecording, stopRecording, transcribeAudio } from '@/utils/audioRecorder'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

// ── 상태 타입 ─────────────────────────────────────────────────

interface MessageItem extends ChatMessage {
  diagnosisResult?: DiagnosisResult | null
  urgency?: string | null
  ragSources?: string[]
}

interface State {
  messages: MessageItem[]
  streamingContent: string
  isStreaming: boolean
  stage: 'questioning' | 'diagnosis'
  turnCount: number
  sessionId: string | null
  error: string | null
}

type Action =
  | { type: 'ADD_MESSAGE'; message: MessageItem }
  | { type: 'UPDATE_STREAMING'; content: string }
  | { type: 'FINISH_STREAMING'; aiMessage: MessageItem }
  | { type: 'SET_STAGE'; stage: 'questioning' | 'diagnosis'; turnCount: number }
  | { type: 'SET_SESSION'; sessionId: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' }

const initialState: State = {
  messages: [],
  streamingContent: '',
  isStreaming: false,
  stage: 'questioning',
  turnCount: 0,
  sessionId: null,
  error: null,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message], error: null }
    case 'UPDATE_STREAMING':
      return { ...state, streamingContent: action.content, isStreaming: true }
    case 'FINISH_STREAMING':
      return {
        ...state,
        messages: [...state.messages, action.aiMessage],
        streamingContent: '',
        isStreaming: false,
      }
    case 'SET_STAGE':
      return { ...state, stage: action.stage, turnCount: action.turnCount }
    case 'SET_SESSION':
      return { ...state, sessionId: action.sessionId }
    case 'SET_ERROR':
      return { ...state, error: action.error, isStreaming: false, streamingContent: '' }
    case 'RESET':
      return { ...initialState }
    default:
      return state
  }
}

// ── Thinking 모드 단계 메시지 ────────────────────────────────
const THINKING_STAGES = [
  '증상을 분석하고 있어요...',
  '관련 자료를 검색하고 있어요...',
  '진단 보고서를 작성하고 있어요...',
]

// ── 스티커 맵 (urgency → 이모지) ────────────────────────────
const STICKER_MAP: Record<string, string> = {
  normal: '정상',
  caution: '주의',
  visit: '병원',
  emergency: '긴급',
  green: '양호',
  orange: '주의',
  red: '긴급',
  greeting: '안녕',
  encourage: '응원',
}

// ── 긴급도 설정 ───────────────────────────────────────────────

const URGENCY_CONFIG = {
  green: {
    bg: '#E8F5E9',
    border: '#4CAF50',
    title: '계속 관찰',
    titleColor: '#1B5E20',
  },
  orange: {
    bg: '#FFF8E1',
    border: '#FF9800',
    title: '이번 주 내 병원 방문',
    titleColor: '#E65100',
  },
  red: {
    bg: '#FFEBEE',
    border: '#F44336',
    title: '24시간 내 즉시 방문',
    titleColor: '#B71C1C',
  },
} as const

// ── JSON 파싱 헬퍼 (AI가 raw JSON을 반환할 때 처리) ───────────
function tryParseJSON(content: string): Record<string, unknown> | null {
  try {
    const trimmed = content.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return JSON.parse(trimmed)
    }
    const match = trimmed.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/)
    if (match) return JSON.parse(match[1])
    return null
  } catch {
    return null
  }
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────

export default function ConsultScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // Tab Bar 是 position:absolute，需要手动让内容避开它
  // iOS 默认 tab bar 高度 49px，Android 56px
  const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 49 : 56
  const bottomPadding = TAB_BAR_HEIGHT + insets.bottom

  const [state, dispatch] = useReducer(reducer, initialState)
  const [inputText, setInputText] = useState('')
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  const [showEmergencyModal, setShowEmergencyModal] = useState(false)
  const [petProfile, setPetProfile] = useState<PetProfile | null>(null)

  // ── 새 상태 ───────────────────────────────────────────────
  const [mode, setMode] = useState<'fast' | 'thinking'>('fast')
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [thinkingStageIndex, setThinkingStageIndex] = useState(0)
  const pulseAnim = useRef(new Animated.Value(1)).current

  const flatListRef = useRef<FlatList<MessageItem>>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const streamBufferRef = useRef('')

  // ── 초기화: 반려동물 로드 + 세션 생성 ─────────────────────
  useEffect(() => {
    let mounted = true

    async function init() {
      const petId = await localCache.getPetId()
      if (!petId) {
        Alert.alert(
          '상담을 시작할 수 없습니다',
          '반려동물을 먼저 선택해 주세요.',
          [
            { text: '기록으로 이동', onPress: () => router.push('/(tabs)/records') },
            { text: '취소', style: 'cancel' },
          ],
        )
        return
      }

      try {
        const pet = await petService.getPet(petId)
        if (mounted) setPetProfile(pet)
      } catch {
        // 프로필 로드 실패는 치명적이지 않음
      }

      try {
        const session = await createChatSession(petId)
        if (mounted) dispatch({ type: 'SET_SESSION', sessionId: session.sessionId })
      } catch {
        if (mounted) {
          dispatch({
            type: 'SET_ERROR',
            error: '상담을 시작할 수 없습니다. 반려동물을 먼저 선택해 주세요.',
          })
        }
      }
    }

    init()
    return () => { mounted = false }
  }, [])

  // ── 언마운트 시 세션 종료 ─────────────────────────────────
  useEffect(() => {
    const sessionId = state.sessionId
    return () => {
      if (sessionId) closeChatSession(sessionId).catch(() => {})
      abortControllerRef.current?.abort()
    }
  }, [state.sessionId])

  // ── 새 메시지 시 자동 스크롤 ─────────────────────────────
  useEffect(() => {
    if (state.messages.length > 0 || state.streamingContent) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80)
    }
  }, [state.messages.length, state.streamingContent])

  // ── Thinking 모드 단계 메시지 순환 ────────────────────────
  useEffect(() => {
    if (mode !== 'thinking' || !state.isStreaming || state.streamingContent) return
    const timer = setInterval(() => {
      setThinkingStageIndex(i => (i + 1) % THINKING_STAGES.length)
    }, 1500)
    return () => clearInterval(timer)
  }, [mode, state.isStreaming, state.streamingContent])

  // ── 마이크 맥박 애니메이션 ────────────────────────────────
  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 500, useNativeDriver: true }),
        ])
      ).start()
    } else {
      pulseAnim.stopAnimation()
      pulseAnim.setValue(1)
    }
  }, [isRecording])

  // ── 이미지 선택 ───────────────────────────────────────────
  async function handleImagePick() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('권한 부족', '시스템 설정에서 앨범 접근을 허용해주세요')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    })
    if (result.canceled) return
    setSelectedImageUri(result.assets[0].uri)
    setPendingImageUrl(null)
  }

  // ── 메시지 전송 ───────────────────────────────────────────
  async function handleSend() {
    const text = inputText.trim()
    if (!text && !selectedImageUri) return
    if (!state.sessionId) {
      Alert.alert('오류', '상담 세션이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.')
      return
    }

    const petId = await localCache.getPetId()
    if (!petId) return

    Keyboard.dismiss()

    // 이미지 업로드
    let imageUrl: string | null = pendingImageUrl
    if (selectedImageUri && !pendingImageUrl) {
      setImageUploading(true)
      try {
        imageUrl = await uploadImage(selectedImageUri, 'health-checks', petId)
        if (imageUrl) setPendingImageUrl(imageUrl)
      } catch {
        Alert.alert('이미지 업로드에 실패했습니다.', '이미지 없이 전송됩니다.')
        imageUrl = null
      } finally {
        setImageUploading(false)
      }
    }

    // 사용자 메시지 추가
    const userMsg: MessageItem = {
      role: 'user',
      content: text || '(이미지)',
      imageUrl,
      turnIndex: state.turnCount + 1,
      timestamp: new Date().toISOString(),
    }
    dispatch({ type: 'ADD_MESSAGE', message: userMsg })
    setInputText('')
    setSelectedImageUri(null)
    setPendingImageUrl(null)

    // AbortController
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    streamBufferRef.current = ''
    dispatch({ type: 'UPDATE_STREAMING', content: '' })

    await sendChatMessage({
      sessionId: state.sessionId,
      petId,
      content: text || '(이미지)',
      imageUrl,
      mode,
      signal: abortControllerRef.current.signal,
      onToken: (token) => {
        streamBufferRef.current += token
        dispatch({ type: 'UPDATE_STREAMING', content: streamBufferRef.current })
      },
      onDone: (result) => {
        let diagnosisResult: DiagnosisResult | null = null
        let aiContent = ''

        if (typeof result.reply === 'object' && result.reply !== null) {
          // 백엔드가 이미 파싱된 객체로 반환한 경우
          diagnosisResult = result.reply as DiagnosisResult
          aiContent =
            diagnosisResult.primaryDiagnosis ||
            streamBufferRef.current ||
            '진단 결과를 확인해 주세요.'
          if (result.urgency === 'red') setShowEmergencyModal(true)
        } else {
          const replyStr =
            typeof result.reply === 'string'
              ? result.reply
              : streamBufferRef.current || '응답을 받지 못했습니다.'

          // 진단 단계이면 JSON 문자열 파싱 시도
          const parsed = result.stage === 'diagnosis'
            ? tryParseJSON(replyStr) ?? tryParseJSON(streamBufferRef.current)
            : null

          if (parsed && parsed.urgency) {
            diagnosisResult = {
              urgency: (parsed.urgency as string) as DiagnosisResult['urgency'],
              primaryDiagnosis: (parsed.primary_diagnosis as string) ?? '',
              symptoms: (parsed.symptoms as string[]) ?? [],
              actionPlan: (parsed.action_plan as string) ?? '',
              homeCare: (parsed.home_care as string) ?? '',
              followUpQuestions: (parsed.follow_up_questions as string[]) ?? [],
              ragSources: (parsed.rag_sources as string[]) ?? [],
            }
            aiContent = diagnosisResult.primaryDiagnosis || '진단 결과를 확인해 주세요.'
            if ((parsed.urgency as string) === 'red') setShowEmergencyModal(true)
          } else {
            aiContent = replyStr
          }
        }

        const aiMsg: MessageItem = {
          role: 'assistant',
          content: aiContent,
          turnIndex: result.turn,
          timestamp: new Date().toISOString(),
          diagnosisResult,
          urgency: result.urgency,
          ragSources: result.ragSources,
        }
        dispatch({ type: 'FINISH_STREAMING', aiMessage: aiMsg })
        dispatch({
          type: 'SET_STAGE',
          stage: result.stage as 'questioning' | 'diagnosis',
          turnCount: result.turn,
        })
      },
      onError: (err) => {
        if (err.name !== 'AbortError') {
          dispatch({
            type: 'SET_ERROR',
            error: '메시지 전송에 실패했습니다. 다시 시도해 주세요.',
          })
        }
      },
    })
  }

  // ── 전송 취소 ───────────────────────────────────────────
  function handleCancel() {
    abortControllerRef.current?.abort()
    dispatch({ type: 'SET_ERROR', error: '' })
  }

  // ── 마이크 버튼 핸들러 ────────────────────────────────────
  async function handleMicPress() {
    if (isRecording) {
      setIsRecording(false)
      const uri = await stopRecording()
      if (!uri) return
      setIsTranscribing(true)
      const transcript = await transcribeAudio(uri)
      setIsTranscribing(false)
      if (transcript) {
        setInputText(prev => prev + transcript)
      } else {
        Alert.alert('음성 인식 실패', '다시 시도해주세요.')
      }
    } else {
      const started = await startRecording()
      if (started) {
        setIsRecording(true)
      } else {
        Alert.alert('마이크 권한이 필요해요.', '설정에서 마이크 접근을 허용해 주세요.')
      }
    }
  }

  // ── 진행 바 (5칸) ────────────────────────────────────────
  const progressStep = Math.min(state.turnCount, 4)

  // ── 메시지 렌더 ───────────────────────────────────────────
  const renderMessage = useCallback(
    ({ item }: { item: MessageItem }) => {
      if (item.role === 'user') {
        return (
          <View style={styles.userBubbleWrap}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.messageThumbnail} />
            ) : null}
            <View style={styles.userBubble}>
              <Text style={styles.userBubbleText}>{item.content}</Text>
            </View>
          </View>
        )
      }

      // item.content가 raw JSON인 경우 파싱하여 diagnosisResult로 사용
      let diagResult = item.diagnosisResult
      let displayContent = item.content
      if (!diagResult) {
        const parsedContent = tryParseJSON(item.content)
        if (parsedContent && parsedContent.urgency) {
          diagResult = {
            urgency: (parsedContent.urgency as string) as DiagnosisResult['urgency'],
            primaryDiagnosis: (parsedContent.primary_diagnosis as string) ?? '',
            symptoms: (parsedContent.symptoms as string[]) ?? [],
            actionPlan: (parsedContent.action_plan as string) ?? '',
            homeCare: (parsedContent.home_care as string) ?? '',
            followUpQuestions: (parsedContent.follow_up_questions as string[]) ?? [],
            ragSources: (parsedContent.rag_sources as string[]) ?? [],
          }
          displayContent = diagResult.primaryDiagnosis || '진단 결과를 확인해 주세요.'
        }
      }
      const urgency = (item.urgency ?? diagResult?.urgency) as keyof typeof URGENCY_CONFIG | null

      return (
        <View style={styles.aiBubbleWrap}>
          <View style={styles.aiAvatar}>
            <Text style={styles.aiAvatarText}>AI</Text>
          </View>
          <View style={styles.aiBubbleContent}>
            <View style={styles.aiBubble}>
              <Text style={styles.aiBubbleText}>{displayContent}</Text>
            </View>
            {diagResult && urgency && URGENCY_CONFIG[urgency] ? (
              <View
                style={[
                  styles.diagnosisCard,
                  {
                    backgroundColor: URGENCY_CONFIG[urgency].bg,
                    borderColor: URGENCY_CONFIG[urgency].border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.diagnosisTitleText,
                    { color: URGENCY_CONFIG[urgency].titleColor },
                  ]}
                >
                  {URGENCY_CONFIG[urgency].title}
                </Text>
                {diagResult.primaryDiagnosis ? (
                  <Text style={styles.diagnosisPrimary}>{diagResult.primaryDiagnosis}</Text>
                ) : null}
                {diagResult.actionPlan ? (
                  <Text style={styles.diagnosisSection}>처치: {diagResult.actionPlan}</Text>
                ) : null}
                {diagResult.homeCare ? (
                  <Text style={styles.diagnosisSection}>간호: {diagResult.homeCare}</Text>
                ) : null}
                {item.ragSources && item.ragSources.filter(Boolean).length > 0 ? (
                  <Text style={styles.ragSources}>
                    참고: {item.ragSources.filter(Boolean).join(', ')}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {/* 스티커 (urgency에 따른 이모지) */}
            <Text style={styles.stickerText}>
              {STICKER_MAP[item.urgency ?? 'normal'] ?? STICKER_MAP.normal}
            </Text>
          </View>
        </View>
      )
    },
    [],
  )

  // ── 스트리밍 중 임시 말풍선 ──────────────────────────────
  const isWaiting = state.isStreaming && !state.streamingContent
  const loadingLabel = isWaiting
    ? mode === 'thinking'
      ? THINKING_STAGES[thinkingStageIndex]
      : petProfile
        ? `${petProfile.name}의 상태를 확인하고 있어요...`
        : '잠시만요, 분석 중입니다...'
    : null

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.container, { paddingBottom: bottomPadding }]}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI 상담</Text>
        {petProfile ? (
          <Text style={styles.headerSub}>{petProfile.name} · {petProfile.species}</Text>
        ) : null}
      </View>

      {/* 진행 바 */}
      <View style={styles.progressWrap}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[
              styles.progressCell,
              i < progressStep && styles.progressCellBlue,
              i === 4 && state.stage === 'diagnosis' && styles.progressCellGreen,
            ]}
          />
        ))}
        <Text style={styles.progressLabel}>
          {state.stage === 'diagnosis' ? '진단 단계' : `질문 ${progressStep}/4`}
        </Text>
      </View>

      {/* 오류 배너 */}
      {state.error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.error}</Text>
        </View>
      ) : null}

      {/* 메시지 + 입력 */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={state.messages}
          keyExtractor={(_, idx) => String(idx)}
          renderItem={renderMessage}
          style={styles.flex}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            <>
              {state.isStreaming && state.streamingContent ? (
                <View style={styles.aiBubbleWrap}>
                  <View style={styles.aiAvatar}>
                    <Text style={styles.aiAvatarText}>AI</Text>
                  </View>
                  <View style={styles.aiBubble}>
                    <Text style={styles.aiBubbleText}>
                      {state.streamingContent.trimStart().startsWith('{')
                        ? '진단 보고서를 작성하고 있어요...'
                        : state.streamingContent}
                      <Text style={styles.streamingCursor}>|</Text>
                    </Text>
                  </View>
                </View>
              ) : null}
              {loadingLabel ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#90CAF9" />
                  <Text style={styles.loadingText}>{loadingLabel}</Text>
                </View>
              ) : null}
            </>
          }
        />

        {/* 입력 영역 */}
        <View style={styles.inputArea}>
          {/* 모드 전환 Pill */}
          <View style={styles.modePillRow}>
            <TouchableOpacity
              style={[styles.modePill, mode === 'fast' && styles.modePillActive]}
              onPress={() => setMode('fast')}
              activeOpacity={0.8}
            >
              <Text style={[styles.modePillText, mode === 'fast' && styles.modePillTextActive]}>
                빠른 답변
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modePill, mode === 'thinking' && styles.modePillActive]}
              onPress={() => setMode('thinking')}
              activeOpacity={0.8}
            >
              <Text style={[styles.modePillText, mode === 'thinking' && styles.modePillTextActive]}>
                깊은 분석
              </Text>
            </TouchableOpacity>
          </View>

          {selectedImageUri ? (
            <View style={styles.imagePreviewRow}>
              <Image source={{ uri: selectedImageUri }} style={styles.imagePreview} />
              <TouchableOpacity
                style={styles.removeImageBtn}
                onPress={() => { setSelectedImageUri(null); setPendingImageUrl(null) }}
              >
                <Text style={styles.removeImageText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TouchableOpacity
              style={styles.imageBtn}
              onPress={handleImagePick}
              accessibilityLabel="사진 첨부"
              disabled={state.isStreaming || imageUploading || isTranscribing}
            >
              {imageUploading
                ? <ActivityIndicator size="small" color="#7A8DA3" />
                : <Text style={styles.imageBtnIcon}>사진</Text>
              }
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder={
                isTranscribing
                  ? '음성을 텍스트로 변환 중...'
                  : mode === 'thinking'
                    ? '증상과 상황을 자세히 설명해줘...'
                    : '메시지를 입력하세요...'
              }
              placeholderTextColor="#B0BEC5"
              multiline
              maxLength={500}
              editable={!state.isStreaming && !isTranscribing}
            />
            {/* 마이크 버튼 */}
            <TouchableOpacity
              style={styles.micBtn}
              onPress={handleMicPress}
              accessibilityLabel="음성 입력"
              disabled={state.isStreaming || isTranscribing}
            >
              {isTranscribing ? (
                <ActivityIndicator size="small" color="#BDE0FE" />
              ) : isRecording ? (
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <Ionicons name="stop-circle" size={22} color="#D32F2F" />
                </Animated.View>
              ) : (
                <Ionicons name="mic-outline" size={22} color="#7A8DA3" />
              )}
            </TouchableOpacity>
            {state.isStreaming ? (
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  mode === 'thinking' && styles.sendBtnThinking,
                  (!inputText.trim() && !selectedImageUri) && styles.sendBtnDisabled,
                ]}
                onPress={handleSend}
                disabled={(!inputText.trim() && !selectedImageUri) || imageUploading || isTranscribing}
              >
                <Text style={[styles.sendBtnText, mode === 'thinking' && styles.sendBtnTextThinking]}>
                  전송
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* 긴급 Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={showEmergencyModal}
        statusBarTranslucent
      >
        <View style={styles.emergencyBackdrop}>
          <View style={styles.emergencySheet}>
            <View style={styles.emergencyIconWrap}>
              <View style={styles.emergencyIconCircle}>
                <Text style={styles.emergencyIconText}>!</Text>
              </View>
            </View>
            <Text style={styles.emergencyTitle}>긴급!</Text>
            <Text style={styles.emergencyBody}>즉시 동물병원에 방문하세요</Text>
            <Text style={styles.emergencyDesc}>
              반려동물의 상태가 긴급합니다. 가장 가까운 동물병원 응급실로 즉시 이동해 주세요.
            </Text>
            <Pressable
              style={styles.emergencyConfirmBtn}
              onPress={() => setShowEmergencyModal(false)}
            >
              <Text style={styles.emergencyConfirmText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ── 스타일 ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFCFF' },
  flex: { flex: 1 },

  header: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8EFF6',
  },
  headerTitle: { fontFamily: 'NotoSerifKR_700Bold', fontSize: 20, color: '#2B3A55' },
  headerSub: { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#7A8DA3', marginTop: 2 },

  progressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    gap: 6,
  },
  progressCell: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#E8EFF6' },
  progressCellBlue: { backgroundColor: '#90CAF9' },
  progressCellGreen: { backgroundColor: '#4CAF50' },
  progressLabel: { fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#7A8DA3', marginLeft: 4 },

  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(255,181,167,0.35)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.3)',
  },
  errorText: { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#5C1A0F' },

  messageList: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },

  userBubbleWrap: { alignItems: 'flex-end', marginBottom: 12 },
  messageThumbnail: { width: 120, height: 90, borderRadius: 12, marginBottom: 6, resizeMode: 'cover' },
  userBubble: {
    maxWidth: '75%',
    backgroundColor: '#2B3A55',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubbleText: { fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#FFFFFF', lineHeight: 22 },

  aiBubbleWrap: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  aiAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#BDE0FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  aiAvatarText: { fontSize: 16 },
  aiBubbleContent: { flex: 1 },
  aiBubble: {
    maxWidth: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#BDE0FE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20,
    shadowRadius: 8,
    elevation: 2,
  },
  aiBubbleText: { fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2B3A55', lineHeight: 22 },
  streamingCursor: { fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#90CAF9' },

  diagnosisCard: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  diagnosisTitleText: { fontFamily: 'Pretendard-SemiBold', fontSize: 14, marginBottom: 8 },
  diagnosisPrimary: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize: 17,
    color: '#2B3A55',
    marginBottom: 8,
  },
  diagnosisSection: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#2B3A55',
    lineHeight: 20,
    marginBottom: 6,
  },
  ragSources: { fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#9E9E9E', marginTop: 6 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 56, paddingVertical: 8, gap: 8 },
  loadingText: { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#7A8DA3' },

  inputArea: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8EFF6',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  imagePreviewRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  imagePreview: { width: 60, height: 60, borderRadius: 10, resizeMode: 'cover' },
  removeImageBtn: {
    marginLeft: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeImageText: { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#555' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  imageBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F4F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageBtnIcon: { fontSize: 18 },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#F4F8FF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2B3A55',
    borderWidth: 1,
    borderColor: '#E8EFF6',
  },
  // ── 모드 Pill ────────────────────────────────────────────
  modePillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  modePill: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#D0D8E8',
    backgroundColor: 'transparent',
  },
  modePillActive: {
    backgroundColor: '#BDE0FE',
    borderColor: '#BDE0FE',
  },
  modePillText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#7A8DA3',
  },
  modePillTextActive: {
    fontFamily: 'Pretendard-SemiBold',
    color: '#2B3A55',
  },

  // ── 마이크 버튼 ──────────────────────────────────────────
  micBtn: {
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── 스티커 ────────────────────────────────────────────────
  stickerText: {
    fontSize: 18,
    marginTop: 4,
    alignSelf: 'flex-end',
  },

  sendBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#BDE0FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnThinking: { backgroundColor: '#2B3A55' },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#2B3A55' },
  sendBtnTextThinking: { color: '#FFFFFF' },
  cancelBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#FFB5A7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#5C1A0F' },

  emergencyBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.70)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencySheet: {
    width: '82%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
  },
  emergencyIconWrap: { marginBottom: 16 },
  emergencyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F44336',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyIconText: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize: 36,
    color: '#FFFFFF',
    lineHeight: 40,
  },
  emergencyTitle: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize: 24,
    color: '#F44336',
    marginBottom: 8,
  },
  emergencyBody: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#2B3A55',
    marginBottom: 10,
    textAlign: 'center',
  },
  emergencyDesc: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#7A8DA3',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emergencyConfirmBtn: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F44336',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyConfirmText: { fontFamily: 'Pretendard-SemiBold', fontSize: 16, color: '#FFFFFF' },
})
