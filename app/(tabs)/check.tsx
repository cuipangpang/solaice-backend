/**
 * check.tsx — 양방향 번역 화면 (인간↔반려동물)
 *
 * - 인간→반려동물: 주인의 말을 반려동물이 이해할 수 있는 표현으로 변환
 * - 반려동물→인간: 반려동물의 행동/소리를 인간의 언어로 해석
 */

import { translate, type TranslateMode } from '@/services/translateService'
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// ── 모드 설정 ────────────────────────────────────────────────
const MODES: { key: TranslateMode; label: string; hint: string }[] = [
  {
    key: 'human_to_pet',
    label: '인간 → 반려동물',
    hint: '예) 오늘 목욕해야 해, 협조해줘',
  },
  {
    key: 'pet_to_human',
    label: '반려동물 → 인간',
    hint: '예) 고양이가 새벽 3시에 계속 울어요',
  },
]

// ── 예시 프롬프트 ─────────────────────────────────────────────
const EXAMPLES: Record<TranslateMode, string[]> = {
  human_to_pet: [
    '오늘은 병원에 가야 해요. 무섭지 않아도 돼요.',
    '잠깐만 혼자 있어야 해. 금방 돌아올게.',
    '이건 네 거야, 건드리면 안 돼.',
  ],
  pet_to_human: [
    '밥 그릇 앞에서 계속 울어요',
    '문 앞에서 빙글빙글 돌아요',
    '갑자기 집 안을 미친 듯이 뛰어다녀요',
  ],
}

// ────────────────────────────────────────────────────────────
export default function TranslateScreen() {
  const [mode, setMode] = useState<TranslateMode>('human_to_pet')
  const [inputText, setInputText] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<TextInput>(null)

  const currentMode = MODES.find((m) => m.key === mode)!

  async function handleTranslate() {
    if (!inputText.trim()) {
      Alert.alert('입력 필요', '번역할 내용을 입력해주세요.')
      return
    }
    Keyboard.dismiss()
    setLoading(true)
    setResult(null)
    try {
      const translated = await translate(inputText, mode)
      setResult(translated)
    } catch (e: any) {
      Alert.alert('번역 오류', e?.message ?? '다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  function handleModeChange(newMode: TranslateMode) {
    if (newMode === mode) return
    setMode(newMode)
    setInputText('')
    setResult(null)
  }

  function handleExamplePress(example: string) {
    setInputText(example)
    setResult(null)
    inputRef.current?.focus()
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── 헤더 ──────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.title}>양방향 번역</Text>
            <Text style={styles.subtitle}>
              인간과 반려동물의 언어를 연결해드려요
            </Text>
          </View>

          {/* ── 모드 토글 ─────────────────────────────────── */}
          <View style={styles.modeToggle}>
            {MODES.map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[
                  styles.modeBtn,
                  mode === m.key && styles.modeBtnActive,
                ]}
                activeOpacity={0.75}
                onPress={() => handleModeChange(m.key)}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    mode === m.key && styles.modeBtnTextActive,
                  ]}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── 입력 카드 ─────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>
              {mode === 'human_to_pet'
                ? '반려동물에게 전할 말'
                : '반려동물의 행동 또는 소리'}
            </Text>
            <TextInput
              ref={inputRef}
              style={styles.textInput}
              placeholder={currentMode.hint}
              placeholderTextColor="#B0BEC5"
              value={inputText}
              onChangeText={setInputText}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />

            {/* ── 예시 chips ────────────────────────────── */}
            <Text style={styles.exampleLabel}>예시</Text>
            <View style={styles.exampleRow}>
              {EXAMPLES[mode].map((ex) => (
                <Pressable
                  key={ex}
                  style={({ pressed }) => [
                    styles.exampleChip,
                    pressed && { opacity: 0.6 },
                  ]}
                  onPress={() => handleExamplePress(ex)}
                >
                  <Text style={styles.exampleChipText}>{ex}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* ── 번역 버튼 ─────────────────────────────────── */}
          <TouchableOpacity
            style={[styles.translateBtn, loading && { opacity: 0.6 }]}
            activeOpacity={0.8}
            onPress={handleTranslate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#2B3A55" />
            ) : (
              <Text style={styles.translateBtnText}>번역하기</Text>
            )}
          </TouchableOpacity>

          {/* ── Thinking 표시 ─────────────────────────────── */}
          {loading && (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color="#BDE0FE" />
              <Text style={styles.thinkingText}>
                {mode === 'human_to_pet'
                  ? '반려동물 언어로 변환하고 있어요...'
                  : '반려동물의 마음을 읽고 있어요...'}
              </Text>
            </View>
          )}

          {/* ── 번역 결과 카드 ────────────────────────────── */}
          {result && (
            <View style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultTitle}>
                  {mode === 'human_to_pet' ? '반려동물 언어' : '반려동물의 마음'}
                </Text>
              </View>
              <Text style={styles.resultText}>{result}</Text>

              {/* ── 다시 번역 ────────────────────────────── */}
              <TouchableOpacity
                style={styles.retryBtn}
                activeOpacity={0.7}
                onPress={handleTranslate}
              >
                <Text style={styles.retryBtnText}>다시 번역하기</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── 하단 여백 (Tab Bar) ──────────────────────── */}
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ── 스타일 ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAFCFF',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },

  // 헤더
  header: {
    marginBottom: 20,
  },
  title: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize: 24,
    color: '#2B3A55',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#7A8DA3',
  },

  // 모드 토글
  modeToggle: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EFF6',
  },
  modeBtnActive: {
    backgroundColor: '#BDE0FE',
    borderColor: '#BDE0FE',
  },
  modeIcon: {
    fontSize: 16,
  },
  modeBtnText: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 13,
    color: '#7A8DA3',
  },
  modeBtnTextActive: {
    color: '#2B3A55',
  },

  // 입력 카드
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#BDE0FE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 3,
  },
  cardLabel: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 14,
    color: '#2B3A55',
    marginBottom: 10,
  },
  textInput: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2B3A55',
    minHeight: 100,
    borderWidth: 1,
    borderColor: '#E8EFF6',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FAFCFF',
  },
  exampleLabel: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 12,
    color: '#7A8DA3',
    marginTop: 14,
    marginBottom: 8,
  },
  exampleRow: {
    gap: 8,
  },
  exampleChip: {
    backgroundColor: '#F4F8FF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E8EFF6',
  },
  exampleChipText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#2B3A55',
  },

  // 번역 버튼
  translateBtn: {
    height: 56,
    borderRadius: 28,
    backgroundColor: '#BDE0FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#BDE0FE',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 4,
  },
  translateBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 17,
    color: '#2B3A55',
  },

  // Thinking
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 16,
  },
  thinkingText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#7A8DA3',
  },

  // 결과 카드
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#BDE0FE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(189,224,254,0.4)',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  resultIcon: {
    fontSize: 22,
  },
  resultTitle: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize: 16,
    color: '#2B3A55',
  },
  resultText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 16,
    color: '#2B3A55',
    lineHeight: 26,
    marginBottom: 16,
  },
  retryBtn: {
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(189,224,254,0.4)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBtnText: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 14,
    color: '#2B3A55',
  },
})
