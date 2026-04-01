import { useEffect } from 'react'
import {
  View,
  Text,
  ActivityIndicator,
  StatusBar,
  Image,
  StyleSheet,
} from 'react-native'
import { useRouter } from 'expo-router'
import { getUserId } from '@/utils/storage'

export default function LoadingScreen() {
  const router = useRouter()

  useEffect(() => {
    async function checkAuthAndNavigate() {
      const [userId] = await Promise.all([
        getUserId(),
        new Promise<void>(resolve => setTimeout(resolve, 1500)),
      ])

      if (userId) {
        router.replace('/(tabs)')
      } else {
        router.replace('/login')
      }
    }
    checkAuthAndNavigate()
  }, [])

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* 로고 컨테이너 */}
      <View style={styles.logoWrapper}>
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
      </View>

      {/* 앱 이름 */}
      <Text style={styles.appName}>솔레이스</Text>

      {/* 로딩 인디케이터 */}
      <ActivityIndicator
        size="large"
        color="#FFFFFF"
        style={styles.spinner}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2B3A55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: 96,
    height: 96,
  },
  appName: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 24,
    color: '#FFFFFF',
    marginTop: 20,
  },
  spinner: {
    marginTop: 40,
  },
})
