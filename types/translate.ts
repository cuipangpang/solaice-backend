export type PetType = 'cat' | 'dog' | 'other'

export interface Pet {
  id: string
  name: string
  type: PetType
  avatarUri: string | null
  isMemoMode: boolean
  createdAt: string
  lastMessage: string
  lastMessageTime: string
}

export type MessageType = 'pet_to_human' | 'human_to_pet' | 'memo'

export interface Message {
  id: string
  type: MessageType
  originalAudioUri?: string   // 녹음 파일 로컬 경로 (pet_to_human)
  translatedText?: string     // 번역된 텍스트 / sound_url (human_to_pet)
  humanText?: string          // 인간이 입력한 텍스트
  petSoundKey?: string        // ex) "cat_happy"
  timestamp: string
  isLoading?: boolean
}

export interface PetToHumanResponse {
  translated_text: string
  emotion: string
  va_valence: number
  va_arousal: number
  pet_sound_key: string
}

export interface HumanToPetResponse {
  emotion_label: string
  pet_sound_key: string
  sound_url: string
}
