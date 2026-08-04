# AI Coding Agent 开发规范（冻结版）

> **本文件是 MVP 开发冻结版规范。**  
> AI Coding Agent 必须严格按照 Phase 1 → 7 顺序执行。  
> 关联文档：[MVP开发计划.md](./MVP开发计划.md) | [AI错误处理规范.md](./AI错误处理规范.md) | [../product/MVP范围冻结.md](../product/MVP范围冻结.md)

---

## 执行原则

| 原则 | 说明 |
|------|------|
| 严格按 Phase 顺序 | Phase 1 → 2 → 3 → 4 → 5 → 6 → 7，不跳序 |
| 每 Phase 完成先验证 | 编译通过 + 基本功能可用，再进入下一 Phase |
| 不创建文档文件 | 不创建 .md / README / 文档 |
| 不扩大范围 | 查 [非目标功能.md](../product/非目标功能.md)，不在清单内的才做 |
| 字段以冻结版为准 | `fixed_prompt` 统一命名，不用 `visual_prompt` / `style_prompt` |
| 遇到模糊决策 | 默认选择最小实现，不加功能 |
| 错误处理 | 遵循 [AI错误处理规范.md](./AI错误处理规范.md) |

---

## 技术栈冻结

| 技术 | 版本/说明 |
|------|-----------|
| Next.js | App Router，最新稳定版 |
| TypeScript | strict mode |
| Tailwind CSS | v3 |
| shadcn/ui | 组件库 |
| Supabase | Auth + Postgres + RLS |
| Vercel | 部署 |

---

## Phase 1：初始化项目

**目标**：可运行的空项目骨架。

| 步骤 | 内容 |
|------|------|
| 1.1 | `npx create-next-app@latest` 初始化，选 TypeScript + Tailwind + App Router |
| 1.2 | 安装 shadcn/ui：`npx shadcn-ui@latest init` |
| 1.3 | 安装 Supabase JS：`npm install @supabase/supabase-js @supabase/ssr` |
| 1.4 | 配置 `.env.local`：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `AI_API_KEY` |
| 1.5 | 创建 `lib/supabase/client.ts` + `lib/supabase/server.ts` |
| 1.6 | 配置 `tailwind.config.ts` 主题色 |
| 1.7 | 配置 `tsconfig.json` 路径别名 `@/*` |

**验证标准**：`npm run dev` 启动无报错，首页可访问。

---

## Phase 2：Supabase + Auth

**目标**：数据库建表 + Auth + RLS 全部就绪。

| 步骤 | 内容 |
|------|------|
| 2.1 | 在 Supabase SQL Editor 执行 [Supabase数据库设计.md](../database/Supabase数据库设计.md) 全部建表 SQL |
| 2.2 | 执行 [RLS权限设计.md](../database/RLS权限设计.md) 全部 RLS 策略 |
| 2.3 | 创建 `lib/supabase/middleware.ts`，刷新 session |
| 2.4 | 创建 `middleware.ts`（根目录），保护需登录路由 |
| 2.5 | 创建登录页 `app/(auth)/login/page.tsx` |
| 2.6 | 创建注册页 `app/(auth)/register/page.tsx` |
| 2.7 | Auth Callback `app/auth/callback/route.ts` |

**验证标准**：可注册/登录，未登录访问 `/dashboard` 被重定向到 `/login`。

---

## Phase 3：核心数据模型

**目标**：项目管理 + 故事输入的数据层和页面。

> Story ≠ Script。Story = 用户原始创意，Script = AI 加工后的结构化剧本。

| 步骤 | 内容 |
|------|------|
| 3.1 | **Project CRUD**：`app/(dashboard)/dashboard/page.tsx` 列表 + 新建 |
| 3.2 | Project API Route：`app/api/projects/route.ts`（GET/POST）+ `[id]/route.ts`（GET/PATCH/DELETE） |
| 3.3 | 项目详情页 `app/(dashboard)/projects/[id]/page.tsx`（Tab 导航骨架） |
| 3.4 | **Story 输入页**：`app/(dashboard)/projects/[id]/story/page.tsx` |
| 3.5 | Story API Route：`app/api/projects/[id]/story/route.ts`（GET/POST/PATCH） |
| 3.6 | Story 字段：raw_input / theme / genre / core_conflict / target_emotion |

**验证标准**：可创建/编辑/删除项目，可输入故事（含 theme/genre/core_conflict/target_emotion）。

---

## Phase 4：资产 CRUD

**目标**：三大资产（角色/场景/风格）的增删改查。

> 资产是核心价值，独立为一个 Phase，不和普通 CRUD 混在一起。

| 步骤 | 内容 |
|------|------|
| 4.1 | **Character CRUD**：`app/(dashboard)/projects/[id]/characters/page.tsx`（列表 + 编辑弹窗） |
| 4.2 | Character API：`app/api/projects/[id]/characters/route.ts` + `[characterId]/route.ts` |
| 4.3 | **Location CRUD**：`app/(dashboard)/projects/[id]/locations/page.tsx` |
| 4.4 | Location API：`app/api/projects/[id]/locations/route.ts` + `[locationId]/route.ts` |
| 4.5 | **Visual Style CRUD**：`app/(dashboard)/projects/[id]/style/page.tsx`（项目级唯一） |
| 4.6 | Visual Style API：`app/api/projects/[id]/style/route.ts` |

**冻结字段**（以 [MVP范围冻结.md](../product/MVP范围冻结.md) 为准）：

```
Character:  name, age, gender, appearance, personality, background, clothing, fixed_prompt
Location:   name, description, environment, time, weather, color_style, fixed_prompt
VisualStyle: name, camera_style, color, lighting, cinematography, fixed_prompt
```

**验证标准**：三大资产可在页面增删改查，fixed_prompt 正确保存。

---

## Phase 5：AI 服务层

**目标**：AI 生成能力（剧本/分镜/角色提取）可用。

### 目录结构

```
lib/
  ai/
    types.ts              -- AI 请求/响应类型定义（含 AIErrorResponse）
    provider.ts           -- AI Provider 适配器接口
    adapters/
      deepseek.ts         -- DeepSeek 适配器
      claude.ts           -- Claude 适配器（可选）
      kimi.ts             -- Kimi 适配器（可选）
    ai-service.ts         -- AIService 统一入口
    error-handler.ts      -- 统一错误处理 + 重试逻辑（见 AI错误处理规范.md）
    logger.ts             -- ai_generations 日志写入
  ai-actions/
    characters.ts         -- generateCharacters(storyId)
    script.ts             -- generateScript(projectId)
    storyboard.ts         -- generateStoryboard(scriptId)
```

### 步骤

| 步骤 | 内容 |
|------|------|
| 5.1 | 定义 AI Provider 接口 `lib/ai/provider.ts` |
| 5.2 | 实现 DeepSeek 适配器 `lib/ai/adapters/deepseek.ts` |
| 5.3 | 实现 AIService 统一入口 `lib/ai/ai-service.ts` |
| 5.4 | 实现 error-handler `lib/ai/error-handler.ts`（重试 + 退避 + 超时） |
| 5.5 | 实现 logger `lib/ai/logger.ts`（写入 ai_generations 表） |
| 5.6 | `lib/ai-actions/characters.ts` → generateCharacters(storyId) |
| 5.7 | `lib/ai-actions/script.ts` → generateScript(projectId) |
| 5.8 | `lib/ai-actions/storyboard.ts` → generateStoryboard(scriptId) |
| 5.9 | Script API Route `app/api/projects/[id]/script/route.ts`（POST 触发生成） |
| 5.10 | Storyboard API Route `app/api/projects/[id]/storyboard/route.ts`（POST 触发生成） |
| 5.11 | 剧本页面 `app/(dashboard)/projects/[id]/script/page.tsx`（展示 AI 生成的剧本） |
| 5.12 | 分镜页面 `app/(dashboard)/projects/[id]/storyboard/page.tsx`（Episode → Scene → Shot 列表） |

**错误处理**：遵循 [AI错误处理规范.md](./AI错误处理规范.md)，自动重试 3 次，失败后展示重试按钮。

**验证标准**：调用 generateScript() 可生成结构化剧本；调用 generateStoryboard() 可生成分镜；失败时正确展示重试按钮。

---

## Phase 6：Prompt Engine

**目标**：Prompt 生成 + 全流程页面可用。

### 目录结构

```
lib/
  ai/
    context-builder.ts    -- 上下文构建器（汇聚五重上下文）
    template-assembler.ts -- Prompt 模板组装器
    output-processor.ts   -- 输出处理器 + context_snapshot 保存
  ai-actions/
    prompt.ts             -- generateImagePrompt() / generateVideoPrompt()
```

### 步骤

| 步骤 | 内容 |
|------|------|
| 6.1 | 实现 ContextBuilder `lib/ai/context-builder.ts`（汇聚五重上下文） |
| 6.2 | 实现 TemplateAssembler `lib/ai/template-assembler.ts` |
| 6.3 | 实现 OutputProcessor `lib/ai/output-processor.ts`（保存 prompts + prompt_versions + context_snapshot） |
| 6.4 | `lib/ai-actions/prompt.ts` → generateImagePrompt(shotId, platform, language) |
| 6.5 | `lib/ai-actions/prompt.ts` → generateVideoPrompt(shotId, platform, language) |
| 6.6 | Prompt API Route `app/api/projects/[id]/prompts/route.ts`（POST 触发生成） |
| 6.7 | **Prompt 工作台页面** `app/(dashboard)/projects/[id]/prompts/page.tsx` |
| 6.8 | Prompt 工作台交互：选镜头 → 选平台 → 选语言 → 生成 → 编辑 → 保存版本 → 复制 |

### ContextBuilder 五重上下文

```
1. Story Context      → story.raw_input
2. Character Context  → characters[].fixed_prompt
3. Location Context   → location.fixed_prompt
4. Visual Style Context → visual_style.fixed_prompt
5. Shot Context       → shot.description / action / emotion / cinematography
```

### context_snapshot 保存

生成 Prompt 时，OutputProcessor 必须保存 `context_snapshot` 到 prompts 表：

```json
{
  "characters": [{ "id": "...", "name": "...", "fixed_prompt": "..." }],
  "location": { "id": "...", "name": "...", "fixed_prompt": "..." },
  "visual_style": { "id": "...", "name": "...", "fixed_prompt": "..." }
}
```

### MVP Prompt 类型

```
✅ 图片 Prompt（即梦 / Midjourney / Flux / ComfyUI × 中文/英文）
✅ 视频 Prompt（可灵 / Runway / LTX）
❌ 声音 Prompt（接口预留，不实现）
❌ 剪辑 Prompt（接口预留，不实现）
```

**验证标准**：从创建项目到生成 Prompt 全流程可走通，Prompt 可复制。

---

## Phase 7：页面体验优化

**目标**：Loading / Error / Toast / Version 等体验完善。

| 步骤 | 内容 |
|------|------|
| 7.1 | **Loading 状态**：所有 AI 生成按钮加 loading spinner + 禁用 |
| 7.2 | **Error 处理**：按 [AI错误处理规范.md](./AI错误处理规范.md) 统一错误展示 + 重试按钮 |
| 7.3 | **Toast**：用 shadcn/ui Sonner 做成功/失败提示 |
| 7.4 | **Version 管理**：Prompt 工作台支持查看历史版本 + 恢复 |
| 7.5 | **空状态**：列表页空数据时展示引导文案 |
| 7.6 | **确认弹窗**：删除操作二次确认 |

**验证标准**：无未处理的 Promise rejection，所有操作有反馈，失败可重试。

---

## 目录结构总览

```
ai-drama-prompt-assistant/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── auth/callback/route.ts
│   ├── (dashboard)/
│   │   ├── dashboard/page.tsx
│   │   └── projects/[id]/
│   │       ├── page.tsx            -- 项目详情
│   │       ├── story/page.tsx      -- 故事输入（Phase 3）
│   │       ├── characters/page.tsx  -- 角色资产（Phase 4）
│   │       ├── locations/page.tsx   -- 场景资产（Phase 4）
│   │       ├── style/page.tsx      -- 视觉风格（Phase 4）
│   │       ├── script/page.tsx     -- 剧本（Phase 5）
│   │       ├── storyboard/page.tsx -- 分镜（Phase 5）
│   │       └── prompts/page.tsx    -- Prompt 工作台（Phase 6）
│   ├── api/
│   │   ├── projects/route.ts
│   │   ├── projects/[id]/route.ts
│   │   ├── projects/[id]/story/route.ts
│   │   ├── projects/[id]/characters/route.ts
│   │   ├── projects/[id]/characters/[characterId]/route.ts
│   │   ├── projects/[id]/locations/route.ts
│   │   ├── projects/[id]/locations/[locationId]/route.ts
│   │   ├── projects/[id]/style/route.ts
│   │   ├── projects/[id]/script/route.ts
│   │   ├── projects/[id]/storyboard/route.ts
│   │   └── projects/[id]/prompts/route.ts
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                          -- shadcn/ui 组件
│   ├── project/
│   ├── assets/
│   ├── script/
│   ├── storyboard/
│   └── prompt/
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── ai/
│   │   ├── types.ts
│   │   ├── provider.ts
│   │   ├── adapters/
│   │   ├── ai-service.ts
│   │   ├── error-handler.ts
│   │   ├── logger.ts
│   │   ├── context-builder.ts
│   │   ├── template-assembler.ts
│   │   └── output-processor.ts
│   └── ai-actions/
│       ├── characters.ts
│       ├── script.ts
│       ├── storyboard.ts
│       └── prompt.ts
├── middleware.ts
├── .env.local
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```
