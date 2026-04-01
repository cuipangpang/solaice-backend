import { apiRequest } from './apiClient'

export interface HealthRecord {
  id: string
  pet_id: string
  created_at: string
  module: string
  module_label: string
  urgency: string
  primary_diagnosis: string
  action_plan: string
  confidence_level?: string
  symptoms?: any[]
  image_url?: string
  image_key?: string
}

export interface HealthRecordCreate {
  pet_id: string
  module: string
  urgency: string
  primary_diagnosis: string
  action_plan: string
  confidence_level?: string
  symptoms?: any[]
  image_url?: string | null
  image_key?: string | null
}

export interface HealthStats {
  total: number
  last_check_at?: string
  by_module: Record<string, number>
}

export const healthRecordService = {
  async createHealthRecord(record: HealthRecordCreate): Promise<HealthRecord> {
    return apiRequest<HealthRecord>('/health-records/', {
      method: 'POST',
      body: JSON.stringify(record),
    })
  },

  async getHealthRecords(petId: string, page = 1, limit = 20): Promise<HealthRecord[]> {
    return apiRequest<HealthRecord[]>(
      `/health-records/?pet_id=${petId}&page=${page}&page_size=${limit}`,
    )
  },

  async getHealthStats(petId: string): Promise<HealthStats> {
    return apiRequest<HealthStats>(`/health-records/stats?pet_id=${petId}`)
  },

  async deleteHealthRecord(id: string): Promise<void> {
    return apiRequest<void>(`/health-records/${id}`, { method: 'DELETE' })
  },
}
