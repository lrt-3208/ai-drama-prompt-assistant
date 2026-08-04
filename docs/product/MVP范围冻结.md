# MVP 范围冻结文档

> **本文件是开发冻结基线，AI Coding Agent 必须严格在此范围内开发。**  
> 不扩大、不增加、不发散。  
> 关联文档：[非目标功能.md](./非目标功能.md) | [../development/MVP开发计划.md](../development/MVP开发计划.md)

---

## 冻结声明

| 项 | 冻结值 |
|----|--------|
| 产品名称 | AI 短剧 Prompt 助手 |
| MVP 核心价值 | Prompt 生产和管理 |
| MVP 必做 | 图片 Prompt + 视频 Prompt 生成 |
| MVP 不做 | 媒体生成 API、自动剪辑、协作、商业化 |
| 技术栈 | Next.js + TypeScript + Tailwind + shadcn/ui + Supabase + Vercel |

---

## 1. MVP 必须实现

### 1.1 用户系统

| 功能 | 实现 |
|------|------|
| 邮箱注册/登录 | Supabase Auth，邮箱+密码 |
| 数据隔离 | RLS 行级安全，用户只能访问自己的数据 |

### 1.2 项目管理

| 功能 | 说明 |
|------|------|
| 创建项目 | name / synopsis / genre |
| 编辑项目 | 修改名称/简介/类型/状态 |
| 删除项目 | 软删除（status='deleted'） |
| 查看项目 | Dashboard 列表 + 详情页 |

### 1.3 故事输入（Story）

> **Story = 用户原始创意**（未经 AI 加工）。区别于 Script（AI 加工后的结构化剧本）。

| 方式 | 说明 |
|------|------|
| 方式1 | 输入一句故事简介 |
| 方式2 | 黏贴已有故事文本 |

**Story 冻结字段**：

| 字段 | 说明 | 示例 |
|------|------|------|
| raw_input | 原始创意文本 | 用户输入的故事 |
| theme | 主题 | 如"重生复仇豪门" |
| genre | 类型 | 如"都市/悬疑/古风" |
| core_conflict | 核心冲突 | 如"被背叛后重返家族夺回一切" |
| target_emotion | 目标情绪 | 如"爽感+紧张+释放" |

输出：结构化 Story（存入 stories 表）。

### 1.4 角色资产系统（Character）

实现 Character CRUD。

**冻结字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | text | 角色名称 |
| age | int | 年龄 |
| gender | text | 性别 |
| appearance | text | 外貌描述 |
| personality | text | 性格 |
| background | text | 背景 |
| clothing | text | 服装 |
| fixed_prompt | text | **固定视觉描述 Prompt**（核心字段） |

### 1.5 场景资产系统（Location）

实现 Location CRUD。

**冻结字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | text | 场景名称 |
| description | text | 场景描述 |
| environment | text | 环境描述 |
| time | text | 时间 |
| weather | text | 天气 |
| color_style | text | 色调 |
| fixed_prompt | text | **固定场景描述 Prompt**（核心字段） |

### 1.6 视觉风格资产（Visual Style）

实现 Visual Style CRUD。

**冻结字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | text | 风格名称 |
| camera_style | text | 摄影风格 |
| color | text | 色彩方案 |
| lighting | text | 光影 |
| cinematography | text | 镜头语言 |
| fixed_prompt | text | **固定风格 Prompt**（核心字段） |

### 1.7 剧本生成（Script）

> **Script = AI 加工后的结构化剧本**（人物/剧情/章节/对白）。Story 是用户原始创意。

Story → Script（AI 生成）。

**Script 输出结构**：

| 字段 | 说明 |
|------|------|
| synopsis | 故事简介 |
| characters | 人物列表 |
| relationships | 人物关系 |
| worldview | 世界观 |
| plot_outline | 剧情大纲（按集） |

### 1.8 分镜生成

Episode → Scene → Shot（AI 生成）。

**Shot 冻结字段**：

| 字段 | 说明 |
|------|------|
| description | 镜头描述 |
| characters | 涉及人物（character_ids 引用） |
| location | 场景（location_id 引用） |
| action | 人物动作 |
| emotion | 情绪 |
| environment | 环境 |
| cinematography | 摄影语言 |

### 1.9 Prompt 生成

**MVP 只实现**：

| 类型 | 平台 | 状态 |
|------|------|------|
| 图片 Prompt | 即梦 / Midjourney / Flux / ComfyUI | ✅ 实现 |
| 视频 Prompt | 可灵 / Runway / LTX | ✅ 实现 |
| 声音 Prompt | 豆包TTS / Qwen-TTS | ❌ 接口预留，不实现 |
| 剪辑 Prompt | — | ❌ 接口预留，不实现 |

---

## 2. 字段命名映射

V2 文档中的部分字段名在冻结版中简化，映射如下：

| V2 文档字段 | 冻结字段 | 说明 |
|-------------|----------|------|
| characters.visual_prompt | characters.fixed_prompt | 统一命名 |
| locations.visual_prompt | locations.fixed_prompt | 统一命名 |
| visual_styles.style_prompt | visual_styles.fixed_prompt | 统一命名 |
| shots.character_ids | shots.character_ids | 不变 |
| scenes.location_id | scenes.location_id | 不变 |

> 开发时以本文件字段名为准。

---

## 3. 冻结边界

```
✅ 用户系统（Auth + RLS）
✅ 项目管理（CRUD）
✅ 故事输入（story / paste）
✅ 剧本生成（AI → 结构化 Script）
✅ 角色资产（CRUD + fixed_prompt）
✅ 场景资产（CRUD + fixed_prompt）
✅ 视觉风格资产（CRUD + fixed_prompt）
✅ 分镜生成（Episode → Scene → Shot）
✅ 图片 Prompt 生成（4 平台 × 2 语言）
✅ 视频 Prompt 生成（3 平台）
✅ Prompt 复制 + 编辑 + 保存
✅ 版本管理（prompt_versions）
✅ context_snapshot（记录生成上下文快照）

❌ 声音 Prompt 生成（仅接口预留）
❌ 剪辑 Prompt 生成（仅接口预留）
❌ 媒体生成 API 调用
❌ 自动剪辑
❌ Agent 自动编排
❌ 多用户协作
❌ 商业化系统
```

---

## 4. AI Coding Agent 开发约束

| 约束 | 说明 |
|------|------|
| 不扩大范围 | 遇到"要不要加这个功能"时，默认不加 |
| 不增加非 MVP 功能 | 声音/剪辑 Prompt 仅留接口，不实现 |
| 所有设计围绕 Prompt 生产 | 核心产出是可复制 Prompt |
| 字段以本文件为准 | fixed_prompt 统一命名 |
| 模块化开发 | 按 Phase 1-6 顺序，每 Phase 可独立验证 |
