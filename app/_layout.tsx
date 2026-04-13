import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import {
  NotoSerifKR_400Regular,
  NotoSerifKR_700Bold,
} from "@expo-google-fonts/noto-serif-kr";
import {
  RobotoMono_400Regular,
  RobotoMono_500Medium,
} from "@expo-google-fonts/roboto-mono";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-reanimated";
import "../global.css";

import { useColorScheme } from "@/components/useColorScheme";

export { ErrorBoundary } from "expo-router";

const DISCLAIMER_KEY = "disclaimer_accepted";

// 在任何渲染发生前锁定 SplashScreen
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    // Noto Serif KR — 标题 / 关键词（권위감）
    NotoSerifKR_400Regular,
    NotoSerifKR_700Bold,

    // Roboto Mono — 数值：체중 / 日期 / 검출수치（정밀감）
    RobotoMono_400Regular,
    RobotoMono_500Medium,

    // Pretendard — 正文 / 按钮 / 说明文字（한국 주류）
    "Pretendard-Regular": require("../assets/fonts/Pretendard-Regular.ttf"),
    "Pretendard-Medium": require("../assets/fonts/Pretendard-Medium.ttf"),
    "Pretendard-SemiBold": require("../assets/fonts/Pretendard-SemiBold.ttf"),
  });

  useEffect(() => {
    if (error) {
      // CTFontManagerError 104 = kCTFontManagerErrorAlreadyRegistered
      // 폰트가 이미 등록된 경우（Hot Reload 또는 시스템 로드）, 비치명적 오류.
      // 폰트는 실제로 사용 가능하므로 크래시하지 않고 계속 렌더링.
      console.warn("[Font] Non-fatal font load warning:", error.message);
      SplashScreen.hideAsync();
    }
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // 폰트 로딩 중（오류 없는 경우）에는 Splash 유지, 그 외에는 렌더링 허용
  if (!loaded && !error) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  // 앱 첫 실행 여부 확인 — 미확인 시 면책 고지 표시
  useEffect(() => {
    AsyncStorage.getItem(DISCLAIMER_KEY).then((val) => {
      if (!val) setShowDisclaimer(true);
    });
  }, []);

  async function handleAccept() {
    await AsyncStorage.setItem(DISCLAIMER_KEY, "true");
    setShowDisclaimer(false);
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack initialRouteName="loading">
        <Stack.Screen name="loading" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="translate/[petId]" options={{ headerShown: false }} />
        <Stack.Screen name="mental/index"           options={{ headerShown: false }} />
        <Stack.Screen name="mental/games"           options={{ headerShown: false }} />
        <Stack.Screen name="mental/game-cat"        options={{ headerShown: false }} />
        <Stack.Screen name="mental/game-dog"        options={{ headerShown: false }} />
        <Stack.Screen name="mental/media"           options={{ headerShown: false }} />
        <Stack.Screen name="mental/preference-test" options={{ headerShown: false }} />
        <Stack.Screen name="mental/profile"         options={{ headerShown: false }} />
        <Stack.Screen name="mental/diary"           options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: "modal" }} />
      </Stack>

      {/* ── 첫 실행 면책 고지 Modal ──────────────────────────── */}
      <Modal
        visible={showDisclaimer}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={ds.overlay}>
          <View style={ds.card}>
            <Text style={ds.title}>중요 안내</Text>
            <Text style={ds.body}>
              솔레이스는 수의사 진료를 대체하지 않습니다.{"\n\n"}
              AI 상담 결과는 참고용이며, 응급 상황 시{"\n"}
              즉시 동물병원을 방문하세요.
            </Text>
            <Pressable
              style={({ pressed }) => [ds.btn, pressed && { opacity: 0.75 }]}
              onPress={handleAccept}
            >
              <Text style={ds.btnText}>확인했습니다</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ThemeProvider>
  );
}

// ── 면책 Modal 스타일 ─────────────────────────────────────────────
const ds = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: "#FAFCFF",
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 28,
    width: "100%",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  title: {
    fontFamily: "NotoSerifKR_700Bold",
    fontSize: 20,
    color: "#2B3A55",
    marginBottom: 16,
  },
  body: {
    fontFamily: "Pretendard-Regular",
    fontSize: 15,
    color: "#4A5A70",
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 28,
  },
  btn: {
    backgroundColor: "#BDE0FE",
    borderRadius: 28,
    paddingHorizontal: 36,
    paddingVertical: 14,
    width: "100%",
    alignItems: "center",
    shadowColor: "#BDE0FE",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 4,
  },
  btnText: {
    fontFamily: "Pretendard-SemiBold",
    fontSize: 16,
    color: "#2B3A55",
  },
});
