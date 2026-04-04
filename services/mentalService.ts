import { apiRequest } from './apiClient'

const BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ─── 타입 정의 ──────────────────────────────────────────────────

export interface MentalProfile {
  id: string
  pet_id: string
  intimacy_score: number         // 0–100
  mental_health_score: number    // 0–100
  mood_today: string | null      // happy/calm/anxious/bored/excited/sad
  total_interactions: number
  games_played: number
  last_interaction_at: string | null
  updated_at: string | null
}

export interface InteractionCreate {
  pet_id: string
  interaction_type: 'feeding' | 'playing' | 'grooming' | 'cuddling' | 'training' | 'walking' | 'game'
  game_key?: string
  duration_seconds?: number
  intensity?: 'low' | 'medium' | 'high'
  notes?: string
  game_score?: number
}

export interface InteractionResult {
  id: string
  pet_id: string
  interaction_type: string
  game_key: string | null
  duration_seconds: number | null
  intensity: string
  notes: string | null
  xp_gained: number
  intimacy_gained: number
  created_at: string
}

export interface DiaryEntry {
  id: string
  pet_id: string
  content: string
  mood: string | null
  date: string
  created_at: string
}

// ─── 기분 레이블 / 이모지 ────────────────────────────────────────

export const MOOD_LABEL: Record<string, string> = {
  happy:   '행복해요',
  calm:    '평온해요',
  anxious: '불안해요',
  bored:   '심심해요',
  excited: '신나요!',
  sad:     '슬퍼요',
}

export const MOOD_EMOJI: Record<string, string> = {
  happy:   '😸',
  calm:    '😌',
  anxious: '😟',
  bored:   '😐',
  excited: '🤩',
  sad:     '😢',
}

// ─── API 함수 ────────────────────────────────────────────────────

export const mentalService = {
  async getProfile(petId: string): Promise<MentalProfile> {
    return apiRequest<MentalProfile>(`/mental/profile/${petId}`)
  },

  async logInteraction(data: InteractionCreate): Promise<InteractionResult> {
    return apiRequest<InteractionResult>('/mental/interaction', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async generateDiary(petId: string, petName: string, petSpecies: string): Promise<DiaryEntry> {
    return apiRequest<DiaryEntry>('/mental/diary/generate', {
      method: 'POST',
      body: JSON.stringify({ pet_id: petId, pet_name: petName, pet_species: petSpecies }),
    })
  },

  async getDiaries(petId: string, limit = 10): Promise<DiaryEntry[]> {
    return apiRequest<DiaryEntry[]>(`/mental/diary/${petId}?limit=${limit}`)
  },
}
