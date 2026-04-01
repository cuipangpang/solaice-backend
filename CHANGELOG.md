# 更新日志

本文件记录项目所有重要变更。
**规范**：从本版本起，所有条目必须使用中文编写，记录详尽、专业。

***

## \[未发布] — 2026-03-12

### 第一阶段 · MVP 核心功能深化开发（续）

***

### 🔧 热修复 — DashScope API 401 未授权

**问题**：调用 AI 诊断 API 时持续返回 `401 Unauthorized`。

**根本原因（双重）**：

1. `API_URL` 指向中国大陆节点 `dashscope.aliyuncs.com`，用户在韩国访问该节点须额外开通国际通道权限
2. `.env` 中存储的是 SiliconFlow 平台的 API Key，并非阿里云百炼的密钥

**修复内容**：

| 变更项            | 修复前                                  | 修复后                                                                       |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `API_URL`      | `https://dashscope.aliyuncs.com/...` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` |
| `API_MODEL`    | `Qwen/Qwen2.5-VL-3B-Instruct`        | `qwen-vl-max`                                                             |
| `.env` API Key | SiliconFlow 密钥                       | 阿里云百炼国际版密钥                                                                |

**架构说明**：DashScope 国际版（新加坡节点）适用于中国大陆以外地区（含韩国），使用 OpenAI 兼容接口格式（Bearer Token 认证，`/compatible-mode/v1/` 路径）。

***

### 📚 任务 6.7 — 诊断引擎注入兽医专业词汇库（Knowledge Anchoring）

#### `services/diagnosisService.ts`（更新）

在 6 个模块的 User Prompt 中注入专业候选词库，强制 VLM 输出临床专业病症描述词。

**核心原理（Knowledge Anchoring）**：
在 Prompt 结尾附加 `候选词库：[...]` 指令，要求模型在描述病症时优先选用列表中的专业术语，从而抑制模糊描述（如"看起来有点红"），输出临床质量文本。

**各模块注入词库**：

| 模块            | 注入词汇示例                                       |
| ------------- | -------------------------------------------- |
| 眼部（eye）       | 结膜充血、角膜混浊、眼睑内翻、瞬膜突出、泪液分泌异常、眼脓性分泌物、虹膜炎、前葡萄膜炎  |
| 口腔（oral）      | 牙龈炎、牙周病、牙结石 I–III 级、口腔黏膜溃疡、牙龈萎缩、咬合异常、口腔黑色素沉着 |
| 皮肤（skin）      | 丘疹、脓疱、鳞屑、苔藓化、脱毛斑、皮肤色素沉着、蠕形螨感染、跳蚤过敏性皮炎        |
| 耳部（ear）       | 耳螨感染、外耳炎、马拉色菌性耳炎、耳道增生、棕黑色蜡质分泌物、耳血肿           |
| 粪便（excrement） | 血便、柏油样便、黏液便、未消化食物残渣、蛔虫、绦虫节片、球虫卵囊、肠道出血        |
| 呕吐物（vomit）    | 胆汁性呕吐、食糜反流、异物梗阻、草食性呕吐、含血呕吐物、泡沫样胃液、肠套叠征兆      |

***

### 🏥 任务 7 — 结构化医疗诊断与治愈系 UI 深度重构

#### `services/diagnosisService.ts`（重构）

**新增接口** **`Symptom`**：

```typescript
export interface Symptom {
  name: string;
  severity: "轻度" | "中度" | "重度";
  location: string;
  evidence: string;
}
```

**扩展接口** **`DiagnosisResult`（新增字段）**：

| 字段                    | 类型                     | 说明                          |
| --------------------- | ---------------------- | --------------------------- |
| `primary_diagnosis`   | `string`               | 主诊断（如"外耳炎合并耳螨感染"）           |
| `confidence_level`    | `"高" \| "中" \| "低"`    | 语义置信度（替代原 0–1 数值）           |
| `reasoning`           | `string`               | 诊断推理过程（2–3 句）               |
| `symptoms`            | `Symptom[]`            | 结构化症状数组（含严重度、位置、证据）         |
| `urgency`             | `"正常" \| "注意" \| "就医"` | 紧急程度（AI 输出限制为 3 档，紧急级仅本地触发） |
| `action_plan`         | `string`               | 行动方案（就医建议 / 观察周期）           |
| `home_care`           | `string`               | 居家护理指导                      |
| `is_content_filtered` | `boolean?`             | 内容安全拦截降级标记                  |

**系统 Prompt 重构**：要求 VLM 以严格 JSON Schema 输出结构化结果，字段全部为中文语义字段，废弃原有数值堆砌格式。

**辅助函数**：

| 函数                                            | 功能                       |
| --------------------------------------------- | ------------------------ |
| `urgencyToHealthScore(u)`                     | 正常→90，注意→65，就医→35，紧急→8   |
| `urgencyToSeverity(u)`                        | 映射到 legacy `severity` 字段 |
| `confidenceLevelToNumber(level)`              | 高→0.90，中→0.70，低→0.45     |
| `buildFullResult(module, data, is_emergency)` | 合并新旧字段，保持向后兼容            |

**Mock 数据升级**：所有 6 个模块的 `MOCK_DATA` 更新为使用专业临床词汇。

#### `app/(tabs)/check.tsx`（完全重写）

基于 UI 设计规范「渐进披露」原则，重构为三层诊断结果展示架构。

**色彩映射系统**：

```
URGENCY_CONFIG:
  正常 → bg:#90CAF9  tagline:"你是一个细心的宠物家长 ✨"
  注意 → bg:#FFE29F  tagline:"发现得早，处理起来会轻松很多"
  就医 → bg:#FFB5A7  tagline:"你及时发现了，这非常重要 ❤️"

SEVERITY_STYLE:
  轻度 → 蓝色系半透明
  中度 → 黄色系半透明
  重度 → 粉红系半透明
```

**第一层 — 主诊断卡（Primary Diagnosis Card）**：

- 大面积情绪色背景，显示 `urgency` 配色
- 顶部：置信度标签（`confidence_level`）
- 主体：`primary_diagnosis` 大号衬线字体
- 副文本：`reasoning` 推理说明
- 底部：情感化 Tagline

**第二层 — 症状列表（Symptom Cards）**：

- `symptoms[]` 逐项展示为 `SymptomCard` 组件
- 每张卡包含：症状名称 + 严重度标签 + 发生位置 + 证据文本
- 严重度标签背景色与 `SEVERITY_STYLE` 一致

**第三层 — 建议卡（Action Cards）**：

- 行动方案卡：`action_plan` 文本 + 🏥 图标
- 居家护理卡：`home_care` 文本 + 🏠 图标

**紧急模态弹窗（Emergency Modal）**：

- `blood_ratio > 0.05` 触发，`Modal` 组件从底部滑入
- 红色顶栏 + "🚨 异常检测" 标题
- 显示 `action_plan` 内容
- 主操作按钮："📞 立即联系附近动物医院"
- 次操作链接："我知道了，稍后处理"

**内容安全拦截横幅**：

- `is_content_filtered === true` 时显示黄色警告横幅
- 提示文案："⚠️ 此图片触发了内容安全审核，以下为参考结果，建议换一张更清晰的照片重试"

***

### 📸 任务 8 — 集成相机拍照与双模上传功能

#### `app/(tabs)/check.tsx`（更新）

**Action Sheet 入口**：

- 原单一"选取图片"按钮更换为 `Alert.alert` 触发的 iOS 风格操作表
- 两个操作：`📷 拍照` → `getCameraAsset()` / `🖼️ 从相册选择` → `getGalleryAsset()`

**相机逻辑（`getCameraAsset`）**：

- 调用 `ImagePicker.requestCameraPermissionsAsync()` 请求权限
- 权限拒绝时弹出友好提示："我们需要相机权限才能帮宠物拍照片哦\~"
- 调用 `ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false })`

**相册逻辑（`getGalleryAsset`）**：

- 调用 `ImagePicker.requestMediaLibraryPermissionsAsync()` 请求权限
- 调用 `ImagePicker.launchImageLibraryAsync({ quality: 0.8 })`

**ROI 裁切复用（`cropImageAsset`）**：

- 复用 `utils/imageProcessor.ts` 中的 `calculateROIWithPadding` + `MODULE_PADDING` 流水线
- 当前以 `mockBBox`（图像中心 60%×60%）模拟检测框，为后续真实目标检测预留接口
- 调用 `ImageManipulator.manipulateAsync` 按模块 padding 裁切，输出 JPEG（compress: 0.85）

**加载状态管理**：

- `setUploading(true)` 在用户选择来源后（Action Sheet 关闭后）触发，避免 Spinner 与 Sheet 同时显示

***

### 🐛 热修复 — `data_inspection_failed` 内容安全拦截自动降级

**问题**：上传宠物粪便、皮肤伤口等医疗图像时，阿里云百炼内容安全系统返回 HTTP 400，错误码 `data_inspection_failed`，导致诊断流程崩溃。

**根本原因**：阿里云对图像内容进行安全扫描，医疗类图像（粪便、脓疱、出血等）可能误触安全规则。

**修复方案（自动降级）**：

```typescript
// callDiagnose 中的拦截处理
if (!response.ok) {
  const errJson = JSON.parse(errText);
  if (errJson?.error?.code === "data_inspection_failed") {
    const mockResult = await mockDiagnose(input);
    return { ...mockResult, is_content_filtered: true };
  }
}
```

- 检测到 `data_inspection_failed` 时自动回退到 `mockDiagnose`
- 降级结果携带 `is_content_filtered: true` 标记
- UI 层通过黄色横幅告知用户，建议换图重试
- 用户体验不中断（仍可看到参考结果）

***

### 📁 文件结构变更（2026-03-12）

```
petHeath/
├── services/
│   └── diagnosisService.ts   ✏️  重构 — 结构化 JSON 输出 + Knowledge Anchoring + data_inspection_failed 降级
├── app/(tabs)/
│   └── check.tsx             ✏️  完全重写 — 渐进披露 UI + 双模上传 + 紧急 Modal
└── .env                      ✏️  更新 — DashScope 国际版 API Key 配置说明
```

***

## \[未发布] — 2026-03-11

### 第一阶段 · MVP 核心功能开发

***

### 🤖 任务 6 — AI 诊断服务接入

#### `services/diagnosisService.ts`（新建）

宠物健康 AI 诊断服务的核心实现，完整架构如下：

**本地紧急触发器（优先级最高）**

- 在发起任何 API 请求之前，检查图像预处理传入的 `blood_ratio` 参数
- `blood_ratio > 0.05`（即血迹像素占比超过 5%）→ **立即**返回紧急结果，触发 `Alert.alert` 弹窗，完全跳过 AI 接口调用
- 紧急结果固定：`health_score: 8`，`severity: "emergency"`，`is_emergency: true`
- 设计原则：安全优先，不以 AI 延迟换取紧急响应速度

**模块化 Prompt 策略**

| 模块            | 核心评估指令                                                           |
| ------------- | ---------------------------------------------------------------- |
| 眼部（eye）       | 强制比较左右眼对称性，输出 `asymmetry_score`；评估结膜充血、分泌物质地、瞳孔大小一致性             |
| 口腔（oral）      | 牙龈颜色与充血程度、牙石 0–3 级分级、口腔黏膜溃疡、牙周状况                                 |
| 皮肤（skin）      | 皮损类型分类、脱毛面积、寄生虫痕迹（跳蚤粪便 / 螨虫管道）、血迹占比                              |
| 耳部（ear）       | 分泌物颜色质地、耳螨特征性黑色颗粒、耳道狭窄程度                                         |
| 粪便（excrement） | 要求逐条列出 `content_findings`：颜色含义、异物识别、寄生虫（蛔虫 / 绦虫）、血迹类型（鲜红 vs 柏油色） |
| 呕吐物（vomit）    | 要求逐条列出 `content_findings`：内容物类型、胆汁判断、异物（骨片 / 绳线 / 植物叶片）、出血识别     |

**眼部多图发送逻辑**

- 眼部模块要求提供 3 张图：全景图（双眼）+ 左眼特写 + 右眼特写
- API 请求一次性包含 3 个 image content block，系统 Prompt 指定每张图的角色
- `asymmetry_score` 字段（0–1）量化左右眼差异程度

**标准化 JSON 输出接口**

```typescript
interface DiagnosisResult {
  health_score: number;         // 0–100，越高越健康，直接映射 HealthCard 分数
  inflammation_score: number;   // 0–100，炎症严重程度
  redness_delta: number;        // 0–255，红色通道偏差量（充血指标）
  asymmetry_score?: number;     // 0–1，仅眼部模块（0=完全对称）
  blood_ratio: number;          // 0–1，血迹像素占比
  anomalies: string[];          // 检测到的异常描述列表
  content_findings?: string[];  // 内容物成分（呕吐物 / 粪便专用）
  confidence: number;           // 0–1，诊断置信度
  advice: string;               // AI 专家建议（150–200 字）
  severity: "normal" | "caution" | "visit" | "emergency";
  is_emergency: boolean;        // 本地规则触发标志
}
```

**图片转 Base64**

- 使用 `expo-image-manipulator.manipulateAsync` 的 `base64: true` 选项
- 压缩率 0.8，输出 JPEG，控制 API token 用量
- 无需额外安装 `expo-file-system`

**Mock 模式（默认启用）**

- 无 API Key 时自动降级到 `mockDiagnose`
- 模拟 1.5 s 网络延迟，每个模块有独立的预设结果
- Mock 数据仍然执行本地紧急触发器逻辑

**真实 API 调用**

- 调用 `https://api.anthropic.com/v1/messages`（claude-sonnet-4-6）
- 支持标准 Anthropic Messages API 多模态格式
- 响应 JSON 解析含健壮性容错（正则提取 + 安全默认值）

**环境变量配置**

- `EXPO_PUBLIC_CLAUDE_API_KEY` — Expo 公共环境变量
- 详见文末「如何配置 API Key」说明

#### `app/(tabs)/check.tsx`（重写）

**UI 数据联动**

- 上传并诊断后，HealthCard 分数绑定到 `diagnosisResult.health_score`（0–100）
- 卡片副文本动态显示检测异常数量
- "重新检测"按钮清空当前结果

**AI 专家建议卡（新增）**

- 白底卡片，Baby Blue 弥散阴影，与 HealthCard 设计语言一致
- 建议正文区域：`ScrollView` 嵌套，`maxHeight: 180`，支持独立滚动
- 量化指标行（`MetricChip`）：炎症评分 / 充血偏差 / 不对称度（眼部），超阈值时自动切换为橙红警示配色
- 异常列表：`anomalies[]` 逐条展示
- 内容物列表：呕吐物 / 粪便模块专用，展示 `content_findings[]`

**眼部三图上传流程**

- 切换到眼部模块时，上传区变为三步选图界面
- 每步独立：点击区域 + 60×60 缩略图预览
- 三张图全部选定后，"开始眼部分析"按钮解锁，触发多图诊断

**本地紧急报警 UI**

- `diagResult.is_emergency === true` 时立即弹出 `Alert.alert`（两个操作按钮：「立即查找附近医院」/ 「我知道了」）
- 不等待用户关闭弹窗，HealthCard 同时更新为红色级别

#### `app/(tabs)/index.tsx`（更新）

**诊断服务集成测试**

- 原"测试上传图片"按钮替换为"测试上传 · 皮肤检测（Mock）"
- 选图后调用 `mockDiagnose({ module: "skin", imageUris: [...] })`
- 诊断完成后 `Alert.alert` 展示 `health_score` + `advice` 完整内容
- 验证从图片选取 → 服务调用 → 结果展示的端到端链路

***

### 📁 文件结构变更（任务 6）

```
petHeath/
├── services/
│   └── diagnosisService.ts     ✨ 新增 — AI 诊断服务（Mock + 真实 API）
├── app/(tabs)/
│   ├── check.tsx               ✏️  重写 — 结果卡 + AI 建议卡 + 眼部三图流程
│   └── index.tsx               ✏️  更新 — 测试按钮接入诊断服务
```

***

### 🌐 任务 5 — 全站中文本地化 + 图像预处理逻辑

#### 全站汉化

- `app/(tabs)/_layout.tsx` — Tab 标题：홈→首页，검사→检测，문진→问诊，기록→档案
- `app/(tabs)/consult.tsx` — 문진→问诊，副标题→"AI 健康问诊"
- `app/(tabs)/records.tsx` — 기록→档案，副标题→"健康时间线"
- `components/HealthCard.tsx` — 状态标签（건강해요→状态良好，조금 신경 써주세요→需要多关注一下，가까운 병원→建议前往附近医院），分值单位 점→分，按钮"오늘 검사 시작하기"→"开始今日检测"
- `app/(tabs)/check.tsx` — 页面标题、副标题、宠物名 / 品种 / 年龄全部汉化
- `app/(tabs)/index.tsx` — 所有按钮文案、分区标题汉化

#### `utils/imageProcessor.ts`（新建）

- `calculateROIWithPadding(bbox, paddingPercent, imageDimensions)` — 按公式扩充检测框并 clamp 到图像边界
  - `W_new = W × (1 + 2p)`，`H_new = H × (1 + 2p)`
  - `x_new = x - W×p`，`y_new = y - H×p`，clamp 到 `[0, 图像宽高]`
- `MODULE_PADDING` 常量：oral=25%，skin=50%，ear=30%，eye=30%，excrement=20%，vomit=20%

#### `app/(tabs)/check.tsx` — 图像选取与裁切

- 模块选择器：6 个模块 Chip（皮肤 / 口腔 / 耳部 / 眼部 / 粪便 / 呕吐物），显示各自 padding 比例
- `expo-image-picker` 相册选取 + 运行时权限请求
- `expo-image-manipulator` 按 ROI 裁切并保存为 JPEG
- 裁切预览图（`Image` 组件，宽高比 1:1）

#### `app/(tabs)/index.tsx` — 测试上传按钮

- 新增"测试上传图片"按钮（secondary 变体），调用 `expo-image-picker` 选图后 `Alert` 展示 URI

***

### 🩺 任务 4 — 检测页健康状态卡片组件

#### 依赖说明

- `react-native-svg` 安装后**已移除**：RN 0.81.5 新架构 + NativeWind Metro 配置导致 Metro 通过 `"react-native": "src/index.ts"` 解析，破坏 TypeScript 导入链（`Unable to resolve '../lib/extract/extractBrush'`）。改用方案 B（纯 View 实现）。

#### `components/HealthCard.tsx`（新建）

宠物健康状态概览卡片核心实现：

**圆环进度指示器（纯 View，无 SVG）**

- 外层 `View`：`borderWidth: 18`，`borderRadius: 66`（直径 132px 的一半），形成彩色圆环
- 内层 `View`（96px，白色背景）居中，形成镂空效果
- `borderColor` 对应情绪温度计色值；挂载时 Reanimated `scale 1→1.03→1` 脉冲动画
- 分数动画：`useSharedValue` → `withTiming(target, 1100ms)` + 透明度淡入

**情绪温度计色系（方案 §3.2）**

| 分数区间  | 颜色            | 徽章背景                     | 徽章文字      |
| ----- | ------------- | ------------------------ | --------- |
| ≥ 80  | `#90CAF9`（正常） | `rgba(144,202,249,0.18)` | `#1A3A5C` |
| 50–79 | `#FFE29F`（注意） | `rgba(255,226,159,0.25)` | `#6B5000` |
| < 50  | `#FFB5A7`（就医） | `rgba(255,181,167,0.25)` | `#6B1A0F` |

**分数字体**：`RobotoMono_400Regular` 38sp，颜色与圆环一致
**状态徽章**：`Pretendard-Medium` 14sp，半透明背景
**情感文案**：源自 UI 规范 §11.1（3 档状态）
**主按钮**：复用 `Button` 组件（`variant="primary"`）

**卡片视觉**

- `backgroundColor: #FFFFFF`，`borderRadius: 24`（圆角 3xl）
- `shadowColor: #BDE0FE`，`shadowOpacity: 0.45`，`shadowRadius: 24` — Baby Blue 弥散阴影
- 宽度 = `screenWidth × 0.85`（两侧各 15% 留白，`useWindowDimensions` 动态计算）

#### `app/(tabs)/check.tsx`（更新）

- 替换占位内容，使用 `ScrollView` 包含 3 张 `HealthCard` 实例（对应温度计三档状态预览）
- 页头采用 `NotoSerifKR_700Bold` + `Pretendard-Regular`，宽度 `85%` 与卡片留白对齐
- `bottomPad: 100` 为悬浮玻璃 Tab Bar 预留底部空间

#### `app/_layout.tsx`（清理）

- 移除已废弃的 `unstable_settings` 导出（在 expo-router v6 中会产生路由警告）

***

### 📁 文件结构变更（任务 4）

```
petHeath/
├── components/
│   └── HealthCard.tsx      ✨ 新增
├── app/
│   ├── _layout.tsx         ✏️  清理 — 移除 unstable_settings
│   └── (tabs)/
│       └── check.tsx       ✏️  更新 — HealthCard 三档预览
```

***

### 🎨 任务 3 — 全局按钮组件

#### `components/Button.tsx`（新建）

实现单一 variant 驱动的 `Button` 组件，覆盖 UI 设计规范 §9 定义的三种按钮类型：

| Variant     | 规范                           | 实现细节                                                                                          |
| ----------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `primary`   | §9.1 — Baby Blue 背景，胶囊形，弥散阴影 | `borderRadius:28`，`shadowColor:#BDE0FE`，`shadowOpacity:0.4`，`shadowRadius:16`                 |
| `secondary` | §9.2 — 半透明果冻边框               | `backgroundColor:rgba(189,224,254,0.4)`，`borderColor:rgba(255,255,255,0.6)`，`borderWidth:0.5` |
| `emergency` | §9.3 — 警示红，方圆角，白色文字          | `borderRadius:16`，`backgroundColor:#D32F2F`，白色文字（唯一例外）                                        |

**附加 Props**

- `loading` — 显示 `ActivityIndicator`，隐藏标签
- `disabled` — `opacity: 0.4`
- `style` / `labelStyle` — 单次覆盖逃生口

**按压动画（UI 设计规范 §6）**

- `useSharedValue` + `useAnimatedStyle`，按压时 `scale: 0.95`，释放时 `scale: 1.0`，动画时长 100ms

**字体**：所有按钮标签使用 `Pretendard-SemiBold` 16sp（§4 按钮文字规范）
**无障碍**：`accessibilityRole="button"`，`accessibilityLabel`，`accessibilityState` 全部配置

***

### 📁 文件结构变更（任务 3）

```
petHeath/
├── components/
│   └── Button.tsx          ✨ 新增
└── app/(tabs)/
    └── index.tsx           ✏️  更新 — 按钮组件预览脚手架
```

***

### 🚀 项目初始化

- 使用 `npx create-expo-app@latest . --template tabs` 初始化 Expo 项目
- 基础模板内置：`expo-router`（文件路由）、`react-native-reanimated`、`expo-splash-screen`、`expo-font`、TypeScript 支持
- 初始 Expo SDK 版本：**55.0.x** · React Native：**0.83.2** · React：**19.2.0**
- 确认 `expo-router` 入口（`"main": "expo-router/entry"`）及 typed routes 实验特性已在 `app.json` 启用

***

### ⚙️ 任务 1 — 基础环境与主题配置

#### NativeWind（TailwindCSS）配置

- 安装 `nativewind@4.2.2` 和 `tailwindcss@3.4.19`（开发依赖）
- 创建 `tailwind.config.js`，引入 `nativewind/preset`，配置覆盖 `./app/**` 和 `./components/**` 的 `content` glob
- 创建 `global.css`，包含三条 Tailwind 指令（`@tailwind base/components/utilities`），作为 NativeWind 的 CSS 入口
- 创建 `babel.config.js`：
  - 在 `babel-preset-expo` 内设置 `jsxImportSource: "nativewind"`，使 className 属性可用于所有 RN 核心组件
  - 添加 `"nativewind/babel"` 预设以支持编译时类名解析
- 创建 `metro.config.js`，使用 `withNativeWind` 包装器，指向 `./global.css` 以在 Metro bundler 中启用 CSS 互操作
- 创建 `nativewind-env.d.ts`，包含 `/// <reference types="nativewind/types" />`，启用 `className` prop 的 TypeScript 自动补全

#### 颜色系统（UI 设计规范 §3）

在 `tailwind.config.js → theme.extend.colors` 中配置以下自定义颜色 Token：

| Token              | 十六进制      | 用途               |
| ------------------ | --------- | ---------------- |
| `brand`            | `#BDE0FE` | 主品牌色 — Baby Blue |
| `background`       | `#FAFCFF` | 应用背景 — 近白蓝色调     |
| `card`             | `#FFFFFF` | 卡片背景 — 纯白        |
| `text-primary`     | `#2B3A55` | 主文字色 — 深海军蓝      |
| `text-secondary`   | `#7A8DA3` | 次文字色 — 中灰蓝       |
| `divider`          | `#E8EFF6` | 分割线 — 极浅蓝        |
| `emergency`        | `#D32F2F` | 紧急红 — 限制使用       |
| `status-normal`    | `#90CAF9` | 🔵 健康温度计：正常      |
| `status-caution`   | `#FFE29F` | 🟡 健康温度计：注意      |
| `status-visit`     | `#FFB5A7` | 🟠 健康温度计：就医      |
| `status-emergency` | `#D32F2F` | 🔴 健康温度计：紧急      |

#### 字体系统（UI 设计规范 §4）

- 通过 `npx expo install` 安装 `@expo-google-fonts/noto-serif-kr` 和 `@expo-google-fonts/roboto-mono`
- 从 Pretendard 官方 GitHub 下载 TTF 字体文件至 `assets/fonts/`：
  - `Pretendard-Regular.ttf`
  - `Pretendard-Medium.ttf`
  - `Pretendard-SemiBold.ttf`
- 更新 `app/_layout.tsx`：
  - 将占位字体 `SpaceMono` 替换为完整三字族系统
  - 应用启动时通过 `useFonts()` 预加载全部 7 个字体变体（在 SplashScreen 关闭前完成，防止字体闪烁）
  - 添加 `import "../global.css"` 全局激活 NativeWind

在 `tailwind.config.js` 中注册以下 `fontFamily` Token：

| Token                | 字体                       | 用途               |
| -------------------- | ------------------------ | ---------------- |
| `font-serif`         | `NotoSerifKR_700Bold`    | 页面标题、结果关键词 — 权威感 |
| `font-serif-regular` | `NotoSerifKR_400Regular` | 正文衬线（韩 / 中文内容）   |
| `font-sans`          | `Pretendard-Regular`     | 正文、说明文字          |
| `font-sans-medium`   | `Pretendard-Medium`      | UI 标签、次级 CTA     |
| `font-sans-semibold` | `Pretendard-SemiBold`    | 按钮、卡片标题          |
| `font-mono`          | `RobotoMono_400Regular`  | 数值（体重、日期、评分）     |
| `font-mono-medium`   | `RobotoMono_500Medium`   | 强调数值             |

***

### 📁 文件结构变更（任务 1）

```
petHeath/
├── app/
│   └── _layout.tsx          ✏️  更新 — 字体加载 + global.css 导入
├── assets/
│   └── fonts/
│       ├── Pretendard-Regular.ttf    ✨ 新增
│       ├── Pretendard-Medium.ttf     ✨ 新增
│       └── Pretendard-SemiBold.ttf   ✨ 新增
├── babel.config.js            ✨ 新增
├── metro.config.js            ✨ 新增
├── tailwind.config.js         ✨ 新增
├── global.css                 ✨ 新增
└── nativewind-env.d.ts        ✨ 新增
```

***

### 🗂️ 任务 2 — 导航架构与玻璃拟态 Tab Bar

#### 依赖

- 安装 `expo-blur@14.0.3`（SDK 52 兼容）用于玻璃拟态 Tab Bar 背景

#### Tab 结构

将模板的 2-Tab 脚手架替换为 UI 设计规范 §2.1 定义的 4-Tab 架构：

| Tab | 文件                       | 标题 | 图标（Ionicons Outline）    |
| --- | ------------------------ | -- | ----------------------- |
| 首页  | `app/(tabs)/index.tsx`   | 首页 | `home-outline`          |
| 检测  | `app/(tabs)/check.tsx`   | 检测 | `search-outline`        |
| 问诊  | `app/(tabs)/consult.tsx` | 问诊 | `chatbubble-outline`    |
| 档案  | `app/(tabs)/records.tsx` | 档案 | `document-text-outline` |

- 每个屏幕使用 `SafeAreaView`（`backgroundColor: #FAFCFF`），居中显示 Noto Serif KR 标题 + Pretendard 副标题作为占位内容
- 旧版 `two.tsx` 重命名为 `two.tsx.bak`，通过 `href: null` 从 Tab Bar 隐藏

#### 玻璃拟态 Tab Bar（UI 设计规范 §5.2）

使用 `expo-blur` 实现 `GlassTabBarBackground` 组件：

```
BlurView — tint="light"，intensity={60}
  backgroundColor: rgba(255,255,255,0.4)
  borderTopWidth: 0.5
  borderTopColor: rgba(255,255,255,0.6)
  position: absolute → 页面内容延伸至 Tab Bar 下方
```

- `tabBarStyle.position = "absolute"` 使页面内容可渲染于悬浮玻璃栏之下
- `tabBarActiveTintColor: #2B3A55`（主文字色）/ `tabBarInactiveTintColor: #7A8DA3`（次文字色）
- Tab 标签字体：`Pretendard-Regular`，12sp — 与设计规范 §4 保持一致

#### 关键设计决策

`tabBarBackground` 将 `BlurView` 渲染为全出血底层，而 `tabBarStyle.backgroundColor = "transparent"` 确保原生 Tab 容器不会遮挡模糊效果。这是 React Navigation v7 + expo-blur 玻璃拟态的正确实现模式。

***

### 📁 文件结构变更（任务 2）

```
petHeath/
├── app/
│   └── (tabs)/
│       ├── _layout.tsx     ✏️  重写 — 4-Tab 布局 + 玻璃 Tab Bar
│       ├── index.tsx        ✏️  更新 — 首页占位内容
│       ├── check.tsx        ✨ 新增 — 检测页占位内容
│       ├── consult.tsx      ✨ 新增 — 问诊页占位内容
│       ├── records.tsx      ✨ 新增 — 档案页占位内容
│       └── two.tsx.bak      🗑️  已禁用（从 two.tsx 重命名）
```

***

### 🔧 热修复 — SDK 升级至 54（Expo Go 54.0.0 兼容性）

**问题**：iOS 无法降级 Expo Go；用户设备运行 Expo Go 54.0.0，需要 Expo SDK 54。项目当时运行在 SDK 52。

**处理过程**：

1. 优先安装 `expo@~54.0.0` 拉取新版 CLI
2. 运行 `npx expo install --fix` 计算完整 SDK 54 版本矩阵（预期退出码 1 — 在安装前列出所需版本）
3. 用所有正确版本号重写 `package.json`，恢复 `react-native-worklets`（reanimated v4 对等依赖）
4. `npm install --legacy-peer-deps` 解决过渡期对等依赖冲突
5. 将 `react-native-worklets` 从 `0.7.4` 降级至 `0.5.1`（通过 `npx expo install --check` 确认）
6. 最终 `npx expo install --check` → **"Dependencies are up to date"** ✅

`app/` 目录内文件无任何修改。

#### 版本变更（SDK 52 → SDK 54）

| 包名                        | SDK 52    | SDK 54（已安装） |
| ------------------------- | --------- | ----------- |
| `expo`                    | `52.0.49` | `54.0.33`   |
| `react`                   | `18.3.1`  | `19.1.0`    |
| `react-native`            | `0.76.5`  | `0.81.5`    |
| `expo-router`             | `4.0.22`  | `6.0.23`    |
| `react-native-reanimated` | `3.16.7`  | `4.1.6`     |
| `react-native-worklets`   | 已移除       | `0.5.1`     |

***

### 🔧 热修复 — SDK 降级（Expo Go 兼容性）

**问题**：项目使用 Expo SDK 55（预发布 / Canary 版），与 Expo Go 54.0.2（App Store 最新稳定版，最高支持 SDK 52）不兼容。

**根本原因**：初始化时 `npx create-expo-app@latest` 解析到了 SDK 55 预发布快照。

**解决方案**：将所有包降级至 Expo SDK 52 — 当时 Expo Go 54.x 完整支持的最后一个稳定版本。

***

