import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Message, Pet } from '@/types/translate'

const PETS_KEY = 'solaice_pets'
const msgKey = (petId: string) => `solaice_messages_${petId}`

// ── 宠物列表 ─────────────────────────────────────────────────

export async function getPets(): Promise<Pet[]> {
  try {
    const raw = await AsyncStorage.getItem(PETS_KEY)
    return raw ? (JSON.parse(raw) as Pet[]) : []
  } catch {
    return []
  }
}

export async function savePets(pets: Pet[]): Promise<void> {
  await AsyncStorage.setItem(PETS_KEY, JSON.stringify(pets))
}

export async function addPet(pet: Pet): Promise<void> {
  const pets = await getPets()
  await savePets([pet, ...pets]) // 최신 항목을 맨 위에
}

export async function updatePet(petId: string, updates: Partial<Pet>): Promise<void> {
  const pets = await getPets()
  await savePets(pets.map(p => (p.id === petId ? { ...p, ...updates } : p)))
}

export async function deletePet(petId: string): Promise<void> {
  const pets = await getPets()
  await savePets(pets.filter(p => p.id !== petId))
  await AsyncStorage.removeItem(msgKey(petId))
}

// ── 메시지 ───────────────────────────────────────────────────

export async function getMessages(petId: string): Promise<Message[]> {
  try {
    const raw = await AsyncStorage.getItem(msgKey(petId))
    // 앱 재시작 시 미완료(isLoading) 메시지 제거
    const msgs = raw ? (JSON.parse(raw) as Message[]) : []
    return msgs.filter(m => !m.isLoading)
  } catch {
    return []
  }
}

export async function saveMessages(petId: string, messages: Message[]): Promise<void> {
  await AsyncStorage.setItem(msgKey(petId), JSON.stringify(messages))
}

/** 메시지 추가 + 펫 카드 lastMessage 업데이트 */
export async function addMessage(petId: string, message: Message): Promise<void> {
  const messages = await getMessages(petId)
  await saveMessages(petId, [...messages, message])

  const preview = (message.translatedText || message.humanText || '...').slice(0, 30)
  await updatePet(petId, {
    lastMessage: preview,
    lastMessageTime: message.timestamp,
  })
}

/** 기존 메시지 부분 업데이트 (번역 완료 후 결과 반영) */
export async function updateMessage(
  petId: string,
  messageId: string,
  updates: Partial<Message>,
): Promise<void> {
  const messages = await getMessages(petId)
  await saveMessages(
    petId,
    messages.map(m => (m.id === messageId ? { ...m, ...updates } : m)),
  )
}
