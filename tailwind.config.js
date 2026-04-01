/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // ── 全局调色板 ──────────────────────────────────
        brand: "#BDE0FE",           // 主品牌色：清透婴儿蓝
        background: "#FAFCFF",      // 背景底色：极微弱蓝白
        card: "#FFFFFF",            // 卡片背景：纯白
        "text-primary": "#2B3A55",  // 深色文字：深海蓝
        "text-secondary": "#7A8DA3",// 次级文字：中灰蓝
        divider: "#E8EFF6",         // 分割线：极浅

        // ── 情绪温度计色系（健康状态专用）─────────────────
        "status-normal": "#90CAF9",   // 🔵 正常
        "status-caution": "#FFE29F",  // 🟡 注意
        "status-visit": "#FFB5A7",    // 🟠 建议就医（蜜桃橘）
        "status-emergency": "#D32F2F",// 🔴 紧急

        // ── 紧急警告（与 status-emergency 共用色值）────────
        emergency: "#D32F2F",
      },
      fontFamily: {
        // Noto Serif KR — 页面标题、检测结论关键词（权威感）
        serif: ["NotoSerifKR_700Bold"],
        "serif-regular": ["NotoSerifKR_400Regular"],

        // Pretendard — 正文、按钮、说明文字（韩国主流）
        sans: ["Pretendard-Regular"],
        "sans-medium": ["Pretendard-Medium"],
        "sans-semibold": ["Pretendard-SemiBold"],

        // Roboto Mono — 数值：体重/日期/检测数值（精准感）
        mono: ["RobotoMono_400Regular"],
        "mono-medium": ["RobotoMono_500Medium"],
      },
    },
  },
  plugins: [],
};
