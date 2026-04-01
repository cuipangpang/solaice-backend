import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ── 소셜 로그인 아이콘 ────────────────────────────────────────

function KakaoIcon() {
  return (
    <View style={icon.kakaoCircle}>
      <View style={icon.kakaoBubble} />
      <View style={icon.kakaoBubbleTail} />
    </View>
  )
}

function NaverIcon() {
  return (
    <View style={icon.naverCircle}>
      <Text style={icon.naverN}>N</Text>
    </View>
  )
}

function GoogleIcon() {
  return (
    <View style={icon.googleCircle}>
      <Text style={icon.googleG}>G</Text>
    </View>
  )
}

function AppleIcon() {
  return (
    <View style={icon.appleCircle}>
      <View style={icon.appleStem} />
      <View style={icon.appleBody} />
    </View>
  )
}

// ── 소셜 버튼 ────────────────────────────────────────────────
interface SocialBtnProps {
  IconComp: React.ReactNode
  label: string
  bgColor: string
  textColor: string
  borderColor?: string
  onPress: () => void
}

function SocialBtn({ IconComp, label, bgColor, textColor, borderColor, onPress }: SocialBtnProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.socialBtn,
        {
          backgroundColor: bgColor,
          borderWidth: borderColor ? 1 : 0,
          borderColor: borderColor ?? 'transparent',
        },
        pressed && { opacity: 0.8 },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* 왼쪽 아이콘 영역 */}
      <View style={s.iconSlot}>{IconComp}</View>
      {/* 중앙 텍스트 */}
      <Text style={[s.socialBtnText, { color: textColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
      {/* 오른쪽 균형 더미 */}
      <View style={s.iconSlot} />
    </Pressable>
  )
}

// ── 구분선 ───────────────────────────────────────────────────
function Divider() {
  return (
    <View style={s.dividerRow}>
      <View style={s.dividerLine} />
      <Text style={s.dividerLabel}>또는</Text>
      <View style={s.dividerLine} />
    </View>
  )
}

// ── 메인 ─────────────────────────────────────────────────────
export default function LoginScreen() {
  const router = useRouter()

  async function handleGuest() {
    await AsyncStorage.setItem('guest_mode', 'true')
    router.replace('/(tabs)')
  }

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 로고 영역 ────────────────────────────────────── */}
        <View style={s.logoSection}>
          <Image
            source={require('../assets/images/icon.png')}
            style={s.logoImage}
            resizeMode="contain"
          />
          <Text style={s.appName}>솔레이스</Text>
        </View>

        {/* ── 소셜 로그인 버튼 ──────────────────────────────── */}
        <View style={s.btnSection}>
          <SocialBtn
            IconComp={<KakaoIcon />}
            label="카카오로 계속하기"
            bgColor="#FEE500"
            textColor="#191919"
            onPress={() => Alert.alert('카카오 로그인', '카카오 로그인 연동 준비 중입니다.')}
          />
          <SocialBtn
            IconComp={<NaverIcon />}
            label="네이버로 계속하기"
            bgColor="#03C75A"
            textColor="#FFFFFF"
            onPress={() => Alert.alert('네이버 로그인', '네이버 로그인 연동 준비 중입니다.')}
          />
          <SocialBtn
            IconComp={<GoogleIcon />}
            label="Google로 계속하기"
            bgColor="#FFFFFF"
            textColor="#2B3A55"
            borderColor="#E8EFF6"
            onPress={() => Alert.alert('Google 로그인', 'Google 로그인 연동 준비 중입니다.')}
          />
          {Platform.OS === 'ios' && (
            <SocialBtn
              IconComp={<AppleIcon />}
              label="Apple로 계속하기"
              bgColor="#000000"
              textColor="#FFFFFF"
              onPress={() => Alert.alert('Apple 로그인', 'Apple 로그인 연동 준비 중입니다.')}
            />
          )}
        </View>

        {/* ── 구분선 ───────────────────────────────────────── */}
        <View style={s.dividerSection}>
          <Divider />
        </View>

        {/* ── 게스트 모드 버튼 ──────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [s.guestBtn, pressed && { opacity: 0.6 }]}
          onPress={handleGuest}
          accessibilityRole="button"
          accessibilityLabel="게스트로 시작하기"
        >
          <Text style={s.guestBtnText}>게스트로 시작하기</Text>
        </Pressable>

        {/* ── 하단 약관 ─────────────────────────────────────── */}
        <View style={s.termsSection}>
          <Text style={s.termsText}>
            {'계속 진행하면 '}
            <Text
              style={s.termsLink}
              onPress={() => Alert.alert('서비스 이용약관', '이용약관 내용은 준비 중입니다.')}
            >
              서비스 이용약관
            </Text>
            {' 및 '}
            <Text
              style={s.termsLink}
              onPress={() => Alert.alert('개인정보처리방침', '개인정보처리방침 내용은 준비 중입니다.')}
            >
              개인정보처리방침
            </Text>
            {'에 동의합니다'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

// ── 아이콘 스타일 ─────────────────────────────────────────────
const icon = StyleSheet.create({
  // 카카오: 노란 원 안에 검은 말풍선
  kakaoCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoBubble: {
    width: 14,
    height: 12,
    backgroundColor: '#191919',
    borderRadius: 6,
  },
  kakaoBubbleTail: {
    width: 5,
    height: 5,
    backgroundColor: '#191919',
    borderRadius: 2,
    marginTop: -4,
    marginLeft: -5,
    transform: [{ rotate: '45deg' }],
  },

  // 네이버: 초록 원 안에 흰색 N
  naverCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#03C75A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  naverN: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 18,
  },

  // 구글: 회색 원 안에 파란 G
  googleCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F0F3F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleG: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#4285F4',
    lineHeight: 18,
  },

  // 애플: 검정 원 안에 흰색 줄기+몸통
  appleCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleStem: {
    width: 4,
    height: 5,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    marginBottom: -2,
    marginLeft: 4,
  },
  appleBody: {
    width: 16,
    height: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
  },
})

// ── 레이아웃 스타일 ───────────────────────────────────────────
const s = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FAFCFF',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingBottom: 32,
  },

  // 로고 영역
  logoSection: {
    alignItems: 'center',
    paddingTop: 60,
    marginBottom: 48,
  },
  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 20,
    marginBottom: 16,
  },
  appName: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 28,
    color: '#2B3A55',
  },

  // 소셜 버튼 영역
  btnSection: {
    gap: 12,
  },
  socialBtn: {
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  iconSlot: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialBtnText: {
    flex: 1,
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    textAlign: 'center',
  },

  // 구분선
  dividerSection: {
    marginTop: 24,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E8EFF6',
  },
  dividerLabel: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#7A8DA3',
    marginHorizontal: 8,
  },

  // 게스트 버튼
  guestBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 44,
  },
  guestBtnText: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 15,
    color: '#7A8DA3',
  },

  // 하단 약관
  termsSection: {
    marginTop: 'auto',
    paddingTop: 24,
    alignItems: 'center',
  },
  termsText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#7A8DA3',
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    textDecorationLine: 'underline',
  },
})
