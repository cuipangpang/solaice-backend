/**
 * translate.tsx — 번역 탭 메인: 반려동물 목록 + 새 반려동물 생성 모달
 */

import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Pet, PetType } from '@/types/translate'
import { addPet, deletePet, getPets } from '@/utils/translateStorage'

// ── 헬퍼 ─────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

function formatTime(ts: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const oneDay = 1000 * 60 * 60 * 24
  if (diff < oneDay && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  }
  if (diff < 2 * oneDay) return '어제'
  if (diff < 7 * oneDay) return `${Math.floor(diff / oneDay)}일 전`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ── 동물 타입 옵션 ───────────────────────────────────────────

const PET_TYPES: { key: PetType; label: string; emoji: string }[] = [
  { key: 'cat', label: '고양이', emoji: '🐱' },
  { key: 'dog', label: '강아지', emoji: '🐶' },
  { key: 'other', label: '기타', emoji: '🐾' },
]

// ── 반려동물 카드 ─────────────────────────────────────────────

function PetCard({ pet, onPress }: { pet: Pet; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={onPress}>
      {/* 아바타 */}
      <View style={styles.avatar}>
        {pet.avatarUri ? (
          <Image source={{ uri: pet.avatarUri }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarEmoji}>
            {PET_TYPES.find(t => t.key === pet.type)?.emoji ?? '🐾'}
          </Text>
        )}
      </View>

      {/* 텍스트 영역 */}
      <View style={styles.cardText}>
        <View style={styles.cardRow}>
          <Text style={styles.petName} numberOfLines={1}>{pet.name}</Text>
          <Text style={styles.timeLabel}>{formatTime(pet.lastMessageTime)}</Text>
        </View>
        <Text style={styles.lastMsg} numberOfLines={1}>
          {pet.lastMessage || (pet.isMemoMode ? '📝 메모 모드' : '대화를 시작해보세요')}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

// ── 스와이프 삭제 카드 ────────────────────────────────────────

const SWIPE_REVEAL = -76

function SwipeableCard({
  pet,
  onPress,
  onDelete,
}: {
  pet: Pet
  onPress: () => void
  onDelete: () => void
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const revealed = useRef(false)

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8,
      onPanResponderMove: (_, { dx }) => {
        translateX.setValue(Math.max(Math.min(dx, 0), SWIPE_REVEAL))
      },
      onPanResponderRelease: (_, { dx }) => {
        if (dx < SWIPE_REVEAL / 2) {
          Animated.spring(translateX, { toValue: SWIPE_REVEAL, useNativeDriver: true }).start()
          revealed.current = true
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
          revealed.current = false
        }
      },
    }),
  ).current

  const close = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
    revealed.current = false
  }

  return (
    <View style={{ overflow: 'hidden' }}>
      {/* 삭제 버튼 레이어 */}
      <View style={styles.deleteActionWrap}>
        <TouchableOpacity
          style={styles.deleteActionBtn}
          activeOpacity={0.85}
          onPress={() => { close(); onDelete() }}
        >
          <Text style={styles.deleteActionText}>삭제</Text>
        </TouchableOpacity>
      </View>
      {/* 카드 레이어 */}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <PetCard pet={pet} onPress={() => { close(); onPress() }} />
      </Animated.View>
    </View>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────

export default function TranslateScreen() {
  const router = useRouter()
  const [pets, setPets] = useState<Pet[]>([])
  const [modalVisible, setModalVisible] = useState(false)

  // 모달 폼 상태
  const [petName, setPetName] = useState('')
  const [petType, setPetType] = useState<PetType>('cat')
  const [isMemoMode, setIsMemoMode] = useState(false)
  const [avatarUri, setAvatarUri] = useState<string | null>(null)

  function handleDelete(petId: string) {
    Alert.alert(
      '삭제하시겠습니까?',
      '대화 기록이 완전히 삭제됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            await deletePet(petId)
            setPets(prev => prev.filter(p => p.id !== petId))
          },
        },
      ],
      { cancelable: true },
    )
  }

  // 포커스마다 목록 새로고침
  useFocusEffect(
    useCallback(() => {
      getPets().then(setPets)
    }, []),
  )

  function openModal() {
    setPetName('')
    setPetType('cat')
    setIsMemoMode(false)
    setAvatarUri(null)
    setModalVisible(true)
  }

  async function handleAvatarPick() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 앨범 접근 권한이 필요해요.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (!result.canceled) {
      setAvatarUri(result.assets[0].uri)
    }
  }

  async function handleCreate() {
    if (!petName.trim()) {
      Alert.alert('이름을 입력해주세요.')
      return
    }
    const now = new Date().toISOString()
    const newPet: Pet = {
      id: generateId(),
      name: petName.trim(),
      type: petType,
      avatarUri,
      isMemoMode,
      createdAt: now,
      lastMessage: '',
      lastMessageTime: now,
    }
    await addPet(newPet)
    const updated = await getPets()
    setPets(updated)
    setModalVisible(false)
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── 헤더 ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>번역</Text>
        {pets.length > 0 && (
          <TouchableOpacity style={styles.addBtn} onPress={openModal} activeOpacity={0.7}>
            <Text style={styles.addBtnText}>＋</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── 목록 or 빈 상태 ─────────────────────────────── */}
      {pets.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>🐾</Text>
          <Text style={styles.emptyTitle}>반려동물과 대화해보세요</Text>
          <Text style={styles.emptySub}>소리를 번역하고, 마음을 전해보세요</Text>
          <TouchableOpacity style={styles.startBtn} onPress={openModal} activeOpacity={0.8}>
            <Text style={styles.startBtnText}>새 대화 시작하기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={pets}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <SwipeableCard
              pet={item}
              onPress={() =>
                router.push({ pathname: '/translate/[petId]', params: { petId: item.id } })
              }
              onDelete={() => handleDelete(item.id)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      {/* ── 새 반려동물 모달 ──────────────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalSheetWrap}
        >
          <View style={styles.modalSheet}>
            {/* 드래그 핸들 */}
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>새 반려동물 추가</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* 동물 타입 선택 */}
              <Text style={styles.fieldLabel}>동물 종류</Text>
              <View style={styles.typeRow}>
                {PET_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.typeBtn, petType === t.key && styles.typeBtnActive]}
                    activeOpacity={0.75}
                    onPress={() => setPetType(t.key)}
                  >
                    <Text style={styles.typeEmoji}>{t.emoji}</Text>
                    <Text style={[styles.typeLabel, petType === t.key && styles.typeLabelActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 메모 모드 토글 */}
              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.fieldLabel}>메모 모드</Text>
                  <Text style={styles.fieldSub}>AI 없이 기록만 합니다</Text>
                </View>
                <Switch
                  value={isMemoMode}
                  onValueChange={setIsMemoMode}
                  trackColor={{ false: '#E8EFF6', true: '#BDE0FE' }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* 아바타 선택 */}
              <Text style={styles.fieldLabel}>프로필 사진</Text>
              <TouchableOpacity style={styles.avatarPicker} onPress={handleAvatarPick} activeOpacity={0.8}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarPreview} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarPlaceholderIcon}>📷</Text>
                    <Text style={styles.avatarPlaceholderText}>사진 선택</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* 이름 입력 */}
              <Text style={styles.fieldLabel}>이름</Text>
              <TextInput
                style={styles.nameInput}
                placeholder="이름을 입력하세요"
                placeholderTextColor="#B0BEC5"
                value={petName}
                onChangeText={setPetName}
                returnKeyType="done"
              />

              {/* 완료 버튼 */}
              <TouchableOpacity style={styles.doneBtn} onPress={handleCreate} activeOpacity={0.8}>
                <Text style={styles.doneBtnText}>완료</Text>
              </TouchableOpacity>

              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

// ── 스타일 ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFCFF' },

  // 헤더
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E8EFF6',
  },
  headerTitle: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize: 22,
    color: '#2B3A55',
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#BDE0FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 20,
    color: '#2B3A55',
    lineHeight: 24,
  },

  // 빈 상태
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize: 20,
    color: '#2B3A55',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#7A8DA3',
    textAlign: 'center',
    marginBottom: 32,
  },
  startBtn: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#BDE0FE',
    paddingHorizontal: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#BDE0FE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 3,
  },
  startBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#2B3A55',
  },

  // 카드
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F0F4FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    overflow: 'hidden',
  },
  avatarImg: { width: 52, height: 52 },
  avatarEmoji: { fontSize: 26 },
  cardText: { flex: 1 },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  petName: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#2B3A55',
    flex: 1,
    marginRight: 8,
  },
  timeLabel: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#7A8DA3',
  },
  lastMsg: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#7A8DA3',
  },
  separator: { height: 1, backgroundColor: '#E8EFF6', marginLeft: 86 },

  // 스와이프 삭제
  deleteActionWrap: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 76,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#D32F2F',
  },
  deleteActionBtn: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteActionText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
  },

  // 모달
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalSheetWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    maxHeight: '90%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8EFF6',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize: 18,
    color: '#2B3A55',
    marginBottom: 20,
  },

  // 폼 필드
  fieldLabel: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 13,
    color: '#2B3A55',
    marginBottom: 10,
    marginTop: 4,
  },
  fieldSub: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#7A8DA3',
    marginTop: 2,
  },

  // 동물 타입 선택
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  typeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F4F8FF',
    borderWidth: 1,
    borderColor: '#E8EFF6',
    alignItems: 'center',
    gap: 4,
  },
  typeBtnActive: { backgroundColor: '#BDE0FE', borderColor: '#BDE0FE' },
  typeEmoji: { fontSize: 22 },
  typeLabel: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 12,
    color: '#7A8DA3',
  },
  typeLabelActive: { color: '#2B3A55' },

  // 메모 모드 토글
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 4,
  },

  // 아바타 선택
  avatarPicker: {
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  avatarPreview: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F0F4FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E8EFF6',
    borderStyle: 'dashed',
  },
  avatarPlaceholderIcon: { fontSize: 22, marginBottom: 2 },
  avatarPlaceholderText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 11,
    color: '#7A8DA3',
  },

  // 이름 입력
  nameInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8EFF6',
    backgroundColor: '#FAFCFF',
    paddingHorizontal: 14,
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2B3A55',
    marginBottom: 24,
  },

  // 완료 버튼
  doneBtn: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#BDE0FE',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#BDE0FE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 3,
  },
  doneBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#2B3A55',
  },
})
