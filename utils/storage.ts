import AsyncStorage from '@react-native-async-storage/async-storage'

const PET_ID_KEY = 'cached_pet_id'

/** 只缓存 pet_id，完整数据始终从后端实时获取 */
export const localCache = {
  async savePetId(petId: string): Promise<void> {
    await AsyncStorage.setItem(PET_ID_KEY, petId)
  },

  async getPetId(): Promise<string | null> {
    return AsyncStorage.getItem(PET_ID_KEY)
  },

  async clearPetId(): Promise<void> {
    await AsyncStorage.removeItem(PET_ID_KEY)
  },
}

// ── 사용자 인증 유틸 ─────────────────────────────────────────
const USER_ID_KEY = 'user_id'
const USER_MODE_KEY = 'user_mode'

export async function getUserId(): Promise<string | null> {
  return AsyncStorage.getItem(USER_ID_KEY)
}

export async function setUserId(id: string): Promise<void> {
  await AsyncStorage.setItem(USER_ID_KEY, id)
}

export async function clearUserId(): Promise<void> {
  await AsyncStorage.removeItem(USER_ID_KEY)
}

export async function isGuestMode(): Promise<boolean> {
  const mode = await AsyncStorage.getItem(USER_MODE_KEY)
  return mode === 'guest'
}
