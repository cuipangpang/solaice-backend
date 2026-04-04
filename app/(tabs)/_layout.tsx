import { Tabs } from "expo-router";
import { Platform, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

// ── 设计规范颜色 ────────────────────────────────────────────
const COLOR_ACTIVE = "#2B3A55";   // text-primary  — 选中态
const COLOR_INACTIVE = "#7A8DA3"; // text-secondary — 未选中态

// ── Tab 图标组件 ─────────────────────────────────────────────
type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

function TabIcon({ name, color }: { name: IoniconsName; color: string }) {
  return <Ionicons name={name} size={24} color={color} />;
}

// ── 玻璃拟态 Tab Bar 背景 ─────────────────────────────────────
// 文档规范 §5.2：intensity={60}, tint="light",
//   borderColor: 'rgba(255,255,255,0.6)',
//   backgroundColor: 'rgba(255,255,255,0.4)'
function GlassTabBarBackground() {
  return (
    <BlurView
      tint="light"
      intensity={60}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: "rgba(255,255,255,0.4)",
          borderTopWidth: 0.5,
          borderTopColor: "rgba(255,255,255,0.6)",
          overflow: "hidden",
        },
      ]}
    />
  );
}

// ────────────────────────────────────────────────────────────
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,

        // ── 激活 / 未激活颜色 ──────────────────────────────
        tabBarActiveTintColor: COLOR_ACTIVE,
        tabBarInactiveTintColor: COLOR_INACTIVE,

        // ── 标签字体：Pretendard-Regular 12sp ─────────────
        tabBarLabelStyle: {
          fontFamily: "Pretendard-Regular",
          fontSize: 12,
          marginBottom: Platform.OS === "ios" ? 0 : 4,
        },

        // ── 玻璃拟态背景 ───────────────────────────────────
        tabBarBackground: () => <GlassTabBarBackground />,
        tabBarStyle: {
          position: "absolute",        // 让页面内容延伸到 Tab Bar 下方
          backgroundColor: "transparent",
          borderTopWidth: 0,           // 边框由 BlurView 内部管理
          elevation: 0,
        },
      }}
    >
      {/* Tab 1 — 홈 */}
      <Tabs.Screen
        name="index"
        options={{
          title: "홈",
          tabBarIcon: ({ color }) => (
            <TabIcon name="home-outline" color={color} />
          ),
        }}
      />

      {/* Tab 2 — 번역（translate.tsx） */}
      <Tabs.Screen
        name="translate"
        options={{
          title: "번역",
          tabBarIcon: ({ color }) => (
            <TabIcon name="swap-horizontal-outline" color={color} />
          ),
        }}
      />

      {/* 구 번역 탭 — Tab Bar에서 숨김 */}
      <Tabs.Screen
        name="check"
        options={{ href: null }}
      />

      {/* 건강 검진 페이지（Tab Bar에서 숨김，router.push로 진입） */}
      <Tabs.Screen
        name="health-check"
        options={{ href: null }}
      />

      {/* Tab 3 — 상담 */}
      <Tabs.Screen
        name="consult"
        options={{
          title: "상담",
          tabBarIcon: ({ color }) => (
            <TabIcon name="chatbubble-outline" color={color} />
          ),
        }}
      />

      {/* Tab 4 — 기록 */}
      <Tabs.Screen
        name="records"
        options={{
          title: "기록",
          tabBarIcon: ({ color }) => (
            <TabIcon name="document-text-outline" color={color} />
          ),
        }}
      />

    </Tabs>
  );
}
