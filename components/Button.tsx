/**
 * Button.tsx — 全局按钮组件
 * 严格对应 UI需求文档 §9（按钮设计系统）
 *
 * 三种变体：
 *   primary   — 主 CTA，Baby Blue 背景 + 弥散阴影
 *   secondary — 次级，半透明果冻感边框
 *   emergency — 紧急，警告红背景，唯一允许白色文字
 */

import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

// ── 设计 Token ───────────────────────────────────────────────
const BRAND     = "#BDE0FE"; // 主品牌色
const NAVY      = "#2B3A55"; // 深海蓝（主/次按钮文字）
const RED       = "#D32F2F"; // 紧急警告红
const WHITE     = "#FFFFFF";

export type ButtonVariant = "primary" | "secondary" | "emergency";

interface ButtonProps {
  /** 按钮文字 */
  label: string;
  /** 点击回调 */
  onPress?: () => void;
  /** 变体 */
  variant?: ButtonVariant;
  /** 禁用态 */
  disabled?: boolean;
  /** 加载中（显示 spinner，隐藏文字） */
  loading?: boolean;
  /** 额外容器样式 */
  style?: StyleProp<ViewStyle>;
  /** 额外文字样式 */
  labelStyle?: StyleProp<TextStyle>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  style,
  labelStyle,
}: ButtonProps) {
  // ── 按压动画：scale 0.95, 100ms（文档 §6）──────────────────
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function handlePressIn() {
    scale.value = withTiming(0.95, { duration: 100 });
  }
  function handlePressOut() {
    scale.value = withTiming(1, { duration: 100 });
  }

  const containerStyle = [
    styles.base,
    styles[variant],
    disabled && styles.disabled,
    style,
  ];

  const textColor = variant === "emergency" ? WHITE : NAVY;
  const spinnerColor = variant === "emergency" ? WHITE : NAVY;

  return (
    <AnimatedPressable
      style={[animStyle, containerStyle]}
      onPress={!disabled && !loading ? onPress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <Text style={[styles.label, { color: textColor }, labelStyle]}>
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}

// ── 样式 ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // 所有按钮共享的基础样式
  base: {
    width: "100%",
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  // ── Primary（文档 §9.1）──────────────────────────────────
  primary: {
    borderRadius: 28,             // rounded-full
    backgroundColor: BRAND,
    // 同色系弥散阴影 — 悬浮感核心
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,                 // Android 兼容
  },

  // ── Secondary（文档 §9.2）────────────────────────────────
  secondary: {
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(189,224,254,0.4)", // 品牌蓝极低透明度
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.6)",     // 果冻感边框
    // 轻阴影
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },

  // ── Emergency（文档 §9.3）────────────────────────────────
  emergency: {
    borderRadius: 16,             // 比主按钮方正，传达严肃感
    backgroundColor: RED,
    // 警告红弥散阴影
    shadowColor: RED,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 10,
  },

  // ── 禁用态 ────────────────────────────────────────────────
  disabled: {
    opacity: 0.4,
  },

  // ── 文字（文档 §4：16sp，Pretendard SemiBold）─────────────
  label: {
    fontFamily: "Pretendard-SemiBold",
    fontSize: 16,
    letterSpacing: 0.2,
  },
});
