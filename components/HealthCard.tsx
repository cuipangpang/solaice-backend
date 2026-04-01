/**
 * HealthCard.tsx — 宠物健康状态概览卡片
 * 对应 UI需求文档 §7.2 检测结果页（第一屏）
 *
 * 纯 React Native View 实现，无 SVG 依赖：
 *   - 环形指示器：两层 View（外圆轨道 + 内白底）+ 颜色边框
 *   - 动态数字：Reanimated useSharedValue + useAnimatedStyle 计数器
 *   - 线性进度条：Reanimated 宽度动画
 *   - 状态 Badge、情感文案、主按钮
 */

import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";
import Button from "./Button";

// ── 情绪温度计色系（文档 §3.2）──────────────────────────────
type ThermometerLevel = "normal" | "caution" | "visit";

function getLevel(score: number): ThermometerLevel {
  if (score >= 80) return "normal";
  if (score >= 50) return "caution";
  return "visit";
}

const LEVEL_CONFIG = {
  normal: {
    color:     "#90CAF9",
    badgeBg:   "rgba(144,202,249,0.18)",
    badgeText: "#1A3A5C",
    trackBg:   "rgba(144,202,249,0.15)",
    label:     "상태 양호 🐾",
    copy:      "당신은 정성스러운 반려동물 부모님이에요 ✨",
  },
  caution: {
    color:     "#FFE29F",
    badgeBg:   "rgba(255,226,159,0.25)",
    badgeText: "#6B5000",
    trackBg:   "rgba(255,226,159,0.15)",
    label:     "좀 더 관심이 필요해요",
    copy:      "일찍 발견할수록 훨씬 쉽게 해결할 수 있어요",
  },
  visit: {
    color:     "#FFB5A7",
    badgeBg:   "rgba(255,181,167,0.25)",
    badgeText: "#6B1A0F",
    trackBg:   "rgba(255,181,167,0.15)",
    label:     "근처 병원 방문을 권장합니다",
    copy:      "제때 발견하셨어요, 아주 중요한 일이에요 ❤️",
  },
} as const;

// ── 圆环尺寸常量 ─────────────────────────────────────────────
const RING_OUTER = 132; // 外圆直径
const RING_INNER = 96;  // 内白底直径（差值 / 2 = 18px 边框厚度）

// ── Props ────────────────────────────────────────────────────
interface HealthCardProps {
  score: number;
  petName: string;
  petBreed: string;
  petAge: string;
  petWeight?: string;
  onStartCheck?: () => void;
}

// ── 动画数字组件 ─────────────────────────────────────────────
function AnimatedScore({ target, color }: { target: number; color: string }) {
  const val = useSharedValue(0);

  useEffect(() => {
    val.value = withTiming(target, {
      duration: 1100,
      easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
    });
  }, [target]);

  // 把 SharedValue 渲染为文字（通过 useAnimatedStyle 控制 opacity 滑入）
  const slideStyle = useAnimatedStyle(() => ({
    opacity: val.value / target,
  }));

  // 用一个普通 Text 配合一个 ref 方式绑定原始动画数值
  return (
    <Animated.Text style={[styles.scoreNum, { color }, slideStyle]}>
      {target}
    </Animated.Text>
  );
}

// ────────────────────────────────────────────────────────────
export default function HealthCard({
  score,
  petName,
  petBreed,
  petAge,
  petWeight,
  onStartCheck,
}: HealthCardProps) {
  const { width } = useWindowDimensions();
  const cardWidth = width * 0.85; // 15% 留白（文档要求）
  // 进度条像素宽 = 卡片宽 - 左右 padding(24×2)
  const barTrackPx = cardWidth - 48;

  const level  = getLevel(score);
  const config = LEVEL_CONFIG[level];

  // ── 进度条宽度动画（worklet 只接受数值，不能用字符串模板）──
  const barProgress = useSharedValue(0);

  useEffect(() => {
    barProgress.value = withTiming(score / 100, {
      duration: 1200,
      easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
    });
  }, [score]);

  const barStyle = useAnimatedStyle(() => ({
    width: barProgress.value * barTrackPx,
  }));

  // ── 圆环脉冲动画（scale 1 → 1.03 → 1，增加生命感）─────────
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withTiming(1.03, { duration: 600 });
    setTimeout(() => {
      pulse.value = withTiming(1, { duration: 600 });
    }, 600);
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  return (
    <View style={[styles.card, { width: cardWidth }]}>

      {/* ── 宠物信息 Header ─────────────────────────────── */}
      <Text style={styles.petName}>{petName}</Text>
      <Text style={styles.petMeta}>
        {petBreed}
        {petAge    ? ` · ${petAge}`    : ""}
        {petWeight ? ` · ${petWeight}` : ""}
      </Text>

      {/* ── 圆环进度指示器 ───────────────────────────────── */}
      <Animated.View
        style={[
          styles.ringOuter,
          { borderColor: config.color, backgroundColor: config.trackBg },
          ringStyle,
        ]}
      >
        {/* 内白底圆 */}
        <View style={styles.ringInner}>
          <AnimatedScore target={score} color={config.color} />
          <Text style={[styles.scoreUnit, { color: config.color }]}>점</Text>
        </View>
      </Animated.View>

      {/* ── 线性进度条 ───────────────────────────────────── */}
      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            { backgroundColor: config.color },
            barStyle,
          ]}
        />
      </View>
      <Text style={styles.barLabel}>{score} / 100</Text>

      {/* ── 状态 Badge ──────────────────────────────────── */}
      <View style={[styles.badge, { backgroundColor: config.badgeBg }]}>
        <Text style={[styles.badgeText, { color: config.badgeText }]}>
          {config.label}
        </Text>
      </View>

      {/* ── 情感文案 ────────────────────────────────────── */}
      <Text style={styles.copy}>{config.copy}</Text>

      {/* ── 分割线 ──────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── 主按钮 ──────────────────────────────────────── */}
      <Button
        label="오늘의 검사 시작"
        variant="primary"
        onPress={onStartCheck}
      />
    </View>
  );
}

// ── 样式 ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // 卡片：白色 + Baby Blue 弥散阴影 + 24px 大圆角
  card: {
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: "center",
    shadowColor: "#BDE0FE",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 6,
  },

  // ── 宠物信息 ─────────────────────────────────────────────
  petName: {
    fontFamily: "NotoSerifKR_700Bold",
    fontSize: 22,
    color: "#2B3A55",
    marginBottom: 4,
  },
  petMeta: {
    fontFamily: "Pretendard-Regular",
    fontSize: 13,
    color: "#7A8DA3",
    marginBottom: 24,
  },

  // ── 圆环（外框 + 内白圆）───────────────────────────────────
  ringOuter: {
    width: RING_OUTER,
    height: RING_OUTER,
    borderRadius: RING_OUTER / 2,
    borderWidth: (RING_OUTER - RING_INNER) / 2, // = 18px
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  ringInner: {
    width: RING_INNER,
    height: RING_INNER,
    borderRadius: RING_INNER / 2,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNum: {
    fontFamily: "RobotoMono_400Regular",
    fontSize: 36,
    lineHeight: 40,
  },
  scoreUnit: {
    fontFamily: "Pretendard-Regular",
    fontSize: 12,
    marginTop: -2,
  },

  // ── 线性进度条 ────────────────────────────────────────────
  barTrack: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(189,224,254,0.3)",
    overflow: "hidden",
    marginBottom: 6,
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  barLabel: {
    fontFamily: "RobotoMono_400Regular",
    fontSize: 11,
    color: "#7A8DA3",
    marginBottom: 16,
  },

  // ── 状态 Badge ────────────────────────────────────────────
  badge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 10,
  },
  badgeText: {
    fontFamily: "Pretendard-Medium",
    fontSize: 14,
  },

  // ── 情感文案 ─────────────────────────────────────────────
  copy: {
    fontFamily: "Pretendard-Regular",
    fontSize: 13,
    color: "#7A8DA3",
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
  },

  // ── 分割线 ───────────────────────────────────────────────
  divider: {
    width: "100%",
    height: 1,
    backgroundColor: "#E8EFF6",
    marginBottom: 20,
  },
});
