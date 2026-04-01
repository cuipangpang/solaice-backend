import { apiRequest } from './apiClient'

export interface VaccineRecord {
  id: string
  pet_id: string
  created_at: string
  type: string
  administered_at: string
  next_due_at?: string
  notes?: string
}

export const vaccineService = {
  async getVaccineRecords(petId: string): Promise<VaccineRecord[]> {
    return apiRequest<VaccineRecord[]>(`/vaccine-records/?pet_id=${petId}`)
  },

  async getOverdueVaccines(petId: string): Promise<VaccineRecord[]> {
    return apiRequest<VaccineRecord[]>(`/vaccine-records/overdue?pet_id=${petId}`)
  },
}
