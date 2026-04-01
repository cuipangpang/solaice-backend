import { apiRequest } from './apiClient'

// MVP 阶段固定 user_id，后期接 Auth 时替换
const MVP_USER_ID = 'local_user'

export interface PetProfile {
  id: string
  user_id: string
  name: string
  species: string // 'cat' | 'dog' | 'other'
  breed?: string
  age_years?: number
  gender?: string // 'male' | 'female'
  neutered?: boolean
  medical_history?: string
  allergies?: string
  avatar_url?: string
  birthday?: string
  created_at: string
  updated_at?: string
}

export type PetProfileCreate = Omit<PetProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'>
export type PetProfileUpdate = Partial<PetProfileCreate>

export const petService = {
  async createPet(profile: PetProfileCreate): Promise<PetProfile> {
    return apiRequest<PetProfile>('/pets/', {
      method: 'POST',
      body: JSON.stringify({ ...profile, user_id: MVP_USER_ID }),
    })
  },

  async getPet(petId: string): Promise<PetProfile> {
    return apiRequest<PetProfile>(`/pets/${petId}`)
  },

  async updatePet(petId: string, updates: PetProfileUpdate): Promise<PetProfile> {
    return apiRequest<PetProfile>(`/pets/${petId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
  },

  async deletePet(petId: string): Promise<void> {
    return apiRequest<void>(`/pets/${petId}`, { method: 'DELETE' })
  },
}
