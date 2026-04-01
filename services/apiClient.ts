const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok && response.status !== 422) {
    throw new Error(`HTTP ${response.status}`)
  }

  const json = await response.json()
  if (!json.success) {
    throw new Error(json.error?.message || '请求失败')
  }
  return json.data as T
}
