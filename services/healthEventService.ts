import { apiRequest } from './apiClient'

export type EventType = 'vaccine' | 'birthday' | 'grooming' | 'hospital'

export interface HealthEvent {
  id: string
  pet_id: string
  event_type: EventType
  event_date: string        // YYYY-MM-DD
  next_date?: string | null
  note?: string | null
  created_at: string
}

export interface HealthEventCreate {
  event_type: EventType
  event_date: string
  next_date?: string | null
  note?: string | null
}

export const healthEventService = {
  async getHealthEvents(petId: string): Promise<HealthEvent[]> {
    return apiRequest<HealthEvent[]>(`/pets/${petId}/health-events`)
  },

  async createHealthEvent(petId: string, data: HealthEventCreate): Promise<HealthEvent> {
    return apiRequest<HealthEvent>(`/pets/${petId}/health-events`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async updateHealthEvent(
    petId: string,
    id: string,
    data: Partial<HealthEventCreate>,
  ): Promise<HealthEvent> {
    return apiRequest<HealthEvent>(`/pets/${petId}/health-events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  async deleteHealthEvent(petId: string, id: string): Promise<void> {
    await apiRequest<{ deleted: boolean }>(`/pets/${petId}/health-events/${id}`, {
      method: 'DELETE',
    })
  },
}
