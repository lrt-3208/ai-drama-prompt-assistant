# Task 拆解

> 可执行任务清单，供 AI Coding Agent 按序执行。  
> 关联文档：[开发计划.md](./开发计划.md) | [AI Coding Agent开发规范.md](./AI%20Coding%20Agent开发规范.md)

---

## 任务编号规则

`T{阶段}-{序号}`，如 `T0A-01` = P0-A 阶段第 1 个任务。

---

## P0-A：项目基础

| ID | 任务 | 涉及文件 | 依赖 |
|----|------|----------|------|
| T0A-01 | 初始化 Next.js 项目 + TS + Tailwind + App Router | `package.json` `next.config.js` `tsconfig.json` | — |
| T0A-02 | 安装配置 shadcn/ui + 基础组件 | `components/ui/*` `components.json` | T0A-01 |
| T0A-03 | 配置 Supabase 环境变量 + Client | `.env.local` `lib/supabase/client.ts` `lib/supabase/server.ts` | T0A-01 |
| T0A-04 | 执行 migrations：profiles + projects 表 + RLS + 触发器 | `supabase/migrations/001_init.sql` | T0A-03 |
| T0A-05 | 实现登录/注册页 | `app/(auth)/login/page.tsx` `components/...LoginForm` | T0A-04 |
| T0A-06 | 实现鉴权中间件 | `middleware.ts` | T0A-03 |
| T0A-07 | 实现 Dashboard 页面 | `app/(app)/dashboard/page.tsx` | T0A-04 |
| T0A-08 | 实现项目 CRUD API | `app/api/projects/route.ts` `app/api/projects/[id]/route.ts` | T0A-04 |
| T0A-09 | 实现项目 CRUD 页面组件 | `components/project/*` | T0A-07 T0A-08 |
| T0A-10 | 实现项目工作台布局 | `app/(app)/projects/[id]/layout.tsx` | T0A-09 |

---

## P0-B：故事 + 剧本

| ID | 任务 | 涉及文件 | 依赖 |
|----|------|----------|------|
| T0B-01 | 执行 migrations：stories + scripts 表 + RLS | `supabase/migrations/002_stories_scripts.sql` | T0A-04 |
| T0B-02 | 实现 AIService + DeepSeek 适配器 | `lib/ai/ai-service.ts` `lib/ai/providers/deepseek.ts` `lib/ai/types.ts` | T0A-03 |
| T0B-03 | 实现剧本生成 Prompt 模板 | `lib/ai/templates.ts` | T0B-02 |
| T0B-04 | 实现剧本生成/保存 API | `app/api/projects/[id]/script/generate/route.ts` `app/api/projects/[id]/script/route.ts` | T0B-01 T0B-03 |
| T0B-05 | 实现剧本编辑页组件 | `app/(app)/projects/[id]/script/page.tsx` `components/script/*` | T0B-04 |
| T0B-06 | 实现 project-service / script-service | `services/script-service.ts` | T0B-04 |

---

## P0-C：创作资产中心

| ID | 任务 | 涉及文件 | 依赖 |
|----|------|----------|------|
| T0C-01 | 执行 migrations：characters + locations + visual_styles 表 + RLS | `supabase/migrations/003_assets.sql` | T0B-01 |
| T0C-02 | 实现 projects.visual_style_id 外键 | `supabase/migrations/003_assets.sql` | T0C-01 |
| T0C-03 | 实现角色提取 Prompt 模板 + generateCharacters() | `lib/ai/templates.ts` `lib/ai/prompt-engine.ts` | T0B-02 |
| T0C-04 | 实现角色/场景/风格 CRUD API | `app/api/projects/[id]/characters/*` 等 | T0C-01 |
| T0C-05 | 实现 visual_prompt 重新生成 API | `app/api/characters/[id]/regenerate-prompt/route.ts` | T0C-03 |
| T0C-06 | 实现资产中心页面 + 组件 | `app/(app)/projects/[id]/assets/page.tsx` `components/assets/*` | T0C-04 |
| T0C-07 | 实现 asset-service | `services/asset-service.ts` | T0C-04 |

---

## P0-D：分镜生成

| ID | 任务 | 涉及文件 | 依赖 |
|----|------|----------|------|
| T0D-01 | 执行 migrations：episodes + scenes + shots 表 + RLS | `supabase/migrations/004_storyboard.sql` | T0C-01 |
| T0D-02 | 实现分镜生成 Prompt 模板 + generateStoryboard() | `lib/ai/templates.ts` `lib/ai/prompt-engine.ts` | T0C-03 |
| T0D-03 | 实现分镜生成 API（含批量写入 + 场景资产自动创建） | `app/api/episodes/[epId]/storyboard/generate/route.ts` | T0D-01 T0D-02 |
| T0D-04 | 实现剧集/场景/镜头查询 API | `app/api/projects/[id]/episodes/*` 等 | T0D-01 |
| T0D-05 | 实现分镜页面 + 组件 | `app/(app)/projects/[id]/storyboard/page.tsx` `components/storyboard/*` | T0D-03 T0D-04 |
| T0D-06 | 实现 storyboard-service | `services/storyboard-service.ts` | T0D-03 |

---

## P0-E：Prompt Engine + 图片/视频 Prompt

| ID | 任务 | 涉及文件 | 依赖 |
|----|------|----------|------|
| T0E-01 | 执行 migrations：prompt_templates + prompts + prompt_versions + ai_generations 表 + RLS | `supabase/migrations/005_prompts.sql` | T0D-01 |
| T0E-02 | 预置 13 条平台模板数据 | `supabase/seed.sql` | T0E-01 |
| T0E-03 | 实现 ContextBuilder（五重上下文汇聚） | `lib/ai/context-builder.ts` | T0D-01 T0C-01 |
| T0E-04 | 实现 TemplateAssembler | `lib/ai/template-assembler.ts` | T0E-03 |
| T0E-05 | 实现 OutputProcessor（版本保存逻辑） | `lib/ai/output-processor.ts` | T0E-01 |
| T0E-06 | 实现 PromptEngine 完整类 | `lib/ai/prompt-engine.ts` | T0E-03 T0E-04 T0E-05 |
| T0E-07 | 实现图片 Prompt 生成 API | `app/api/shots/[shotId]/prompts/generate/route.ts` | T0E-06 |
| T0E-08 | 实现视频 Prompt 生成 API | 同上（promptType=video） | T0E-07 |
| T0E-09 | 实现 Prompt 保存 API | `app/api/prompts/[id]/route.ts` | T0E-01 |
| T0E-10 | 实现 Prompt 工作台页面 + 组件 | `app/(app)/projects/[id]/prompts/[shotId]/page.tsx` `components/prompt/*` | T0E-07 |
| T0E-11 | 实现 Claude/Kimi/豆包适配器 | `lib/ai/providers/*.ts` | T0B-02 |
| T0E-12 | 实现 prompt-service | `services/prompt-service.ts` | T0E-07 |

---

## P1-A：声音/剪辑 + 版本管理

| ID | 任务 | 依赖 |
|----|------|------|
| T1A-01 | 声音 Prompt 模板 + generateVoicePrompt() | T0E-06 |
| T1A-02 | 剪辑 Prompt 模板 + generateEditPrompt() | T0E-06 |
| T1A-03 | 版本管理 API（历史/恢复） | T0E-01 |
| T1A-04 | VersionHistory 组件 | T1A-03 |

## P1-B：模板/导出/模型切换

| ID | 任务 | 依赖 |
|----|------|------|
| T1B-01 | AIModelSelector 组件 | T0E-11 |
| T1B-02 | 导出功能（文本/JSON） | T0E-09 |
| T1B-03 | 镜头编辑/重新生成/复制 API | T0D-04 |

---

## 项目目录结构

```
ai-drama-prompt-assistant/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/
│   │   ├── dashboard/page.tsx
│   │   └── projects/[id]/
│   │       ├── layout.tsx
│   │       ├── page.tsx
│   │       ├── script/page.tsx
│   │       ├── assets/page.tsx
│   │       ├── storyboard/page.tsx
│   │       ├── prompts/[shotId]/page.tsx
│   │       └── export/page.tsx
│   ├── api/...
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/ ...
│   ├── layout/ ...
│   ├── project/ ...
│   ├── script/ ...
│   ├── assets/ ...
│   ├── storyboard/ ...
│   ├── prompt/ ...
│   └── common/ ...
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   └── server.ts
│   ├── ai/
│   │   ├── ai-service.ts
│   │   ├── prompt-engine.ts
│   │   ├── context-builder.ts
│   │   ├── template-assembler.ts
│   │   ├── output-processor.ts
│   │   ├── types.ts
│   │   ├── templates.ts
│   │   └── providers/
│   │       ├── base.ts
│   │       ├── deepseek.ts
│   │       ├── claude.ts
│   │       ├── kimi.ts
│   │       └── doubao.ts
│   └── utils.ts
├── services/
│   ├── project-service.ts
│   ├── script-service.ts
│   ├── asset-service.ts
│   ├── storyboard-service.ts
│   └── prompt-service.ts
├── types/
│   ├── database.ts
│   └── models.ts
├── supabase/
│   ├── migrations/
│   │   ├── 001_init.sql
│   │   ├── 002_stories_scripts.sql
│   │   ├── 003_assets.sql
│   │   ├── 004_storyboard.sql
│   │   └── 005_prompts.sql
│   └── seed.sql
├── middleware.ts
├── .env.local
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── components.json
```
