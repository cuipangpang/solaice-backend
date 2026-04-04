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
import { useEffect } from "react";
import "react-native-reanimated";
import "../global.css";

import { useColorScheme } from "@/components/useColorScheme";

export { ErrorBoundary } from "expo-router";

// 在任何渲染发生前锁定 SplashScreen
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    // Noto Serif KR — 标题 / 关键词（权威感）
    NotoSerifKR_400Regular,
    NotoSerifKR_700Bold,

    // Roboto Mono — 数值：体重 / 日期 / 检测数值（精准感）
    RobotoMono_400Regular,
    RobotoMono_500Medium,

    // Pretendard — 正文 / 按钮 / 说明文字（韩国主流）
    "Pretendard-Regular": require("../assets/fonts/Pretendard-Regular.ttf"),
    "Pretendard-Medium": require("../assets/fonts/Pretendard-Medium.ttf"),
    "Pretendard-SemiBold": require("../assets/fonts/Pretendard-SemiBold.ttf"),
  });

  useEffect(() => {
    if (error) {
      // CTFontManagerError 104 = kCTFontManagerErrorAlreadyRegistered
      // 字体已注册（Hot Reload 或系统已加载），属非致命错误。
      // 字体实际上仍然可用，无需崩溃 — 降级为系统字体并继续渲染。
      console.warn("[Font] Non-fatal font load warning:", error.message);
      SplashScreen.hideAsync();
    }
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // 字体加载中（且无错误）时保持 Splash，其他情况均放行渲染
  if (!loaded && !error) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack initialRouteName="loading">
        <Stack.Screen name="loading" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="translate/[petId]" options={{ headerShown: false }} />
        <Stack.Screen name="mental/index"    options={{ headerShown: false }} />
        <Stack.Screen name="mental/games"    options={{ headerShown: false }} />
        <Stack.Screen name="mental/game-cat" options={{ headerShown: false }} />
        <Stack.Screen name="mental/game-dog"        options={{ headerShown: false }} />
        <Stack.Screen name="mental/media"           options={{ headerShown: false }} />
        <Stack.Screen name="mental/preference-test" options={{ headerShown: false }} />
        <Stack.Screen name="mental/profile"         options={{ headerShown: false }} />
        <Stack.Screen name="mental/diary"           options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: "modal" }} />
      </Stack>
    </ThemeProvider>
  );
}
