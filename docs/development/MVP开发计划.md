# MVP 开发计划（5 周周期 · 7 Phase）

> **按照真实开发周期规划，7 个 Phase 对应 [AI Coding Agent开发规范.md](./AI%20Coding%20Agent开发规范.md)。**  
> 关联文档：[../product/MVP范围冻结.md](../product/MVP范围冻结.md) | [AI错误处理规范.md](./AI错误处理规范.md)

---

## 计划总览

| 周次 | 主题 | Phase | 核心产出 |
|------|------|-------|----------|
| Week 1 | 基础设施 + 核心数据 | Phase 1 + 2 + 3 | 项目骨架 + 数据库 + Auth + 项目管理 + 故事 |
| Week 2 | 资产 CRUD | Phase 4 | 角色/场景/视觉风格三大资产 |
| Week 3 | AI 服务层 | Phase 5 | 剧本生成 + 分镜生成 |
| Week 4 | Prompt Engine | Phase 6 | Prompt 生成 + Prompt 工作台 |
| Week 5 | 优化测试 + 部署 | Phase 7 | 体验优化 + 端到端验收 + 上线 |

---

## Week 1：基础设施 + 核心数据（Phase 1 + 2 + 3）

### Day 1-2：项目初始化（Phase 1）

| 任务 | 说明 |
|------|------|
| Next.js 项目初始化 | TypeScript + Tailwind + App Router |
| shadcn/ui 初始化 | 安装 + 配置主题 |
| Supabase 项目创建 | 新建项目，获取 URL + Anon Key |
| 环境变量配置 | `.env.local`（Supabase + AI API Key） |
| lib/supabase/ 工具 | client.ts + server.ts |

**里程碑**：`npm run dev` 启动，首页可访问。

### Day 3-4：数据库 + Auth（Phase 2）

| 任务 | 说明 |
|------|------|
| 执行建表 SQL | 14 张表（含 ai_generations 简化版） |
| 执行 RLS 策略 | 14 张表全部 RLS |
| 创建触发器 | updated_at 自动更新 + handle_new_user |
| 插入预置模板 | prompt_templates 13 条模板 |
| middleware.ts | 刷新 session + 路由保护 |
| 登录/注册页 | 邮箱+密码 |
| Auth Callback | email confirmation 回调 |

**里程碑**：可注册、登录、退出，未登录被重定向。

### Day 5：核心数据模型（Phase 3）

| 任务 | 说明 |
|------|------|
| Dashboard 页面 | 项目列表 + 新建 |
| 项目详情页 | Tab 导航骨架 |
| Project API Route | GET/POST/PATCH/DELETE |
| 故事输入页 | 方式1（简介）+ 方式2（全文黏贴） |
| Story API Route | GET/POST/PATCH |
| Story 字段 | raw_input / theme / genre / core_conflict / target_emotion |

**里程碑**：可创建/编辑/删除项目，可输入故事（含全部字段）。

---

## Week 2：资产 CRUD（Phase 4）

### Day 6-7：角色资产

| 任务 | 说明 |
|------|------|
| 角色资产页 | 列表 + 编辑弹窗 + CRUD |
| Character API Route | GET/POST/PATCH/DELETE |
| 冻结字段 | name / age / gender / appearance / personality / background / clothing / fixed_prompt |
| AI 提取角色（接口预留） | generateCharacters() 接口，Phase 5 实现 |

### Day 8-9：场景 + 视觉风格资产

| 任务 | 说明 |
|------|------|
| 场景资产页 | 列表 + 编辑弹窗 + CRUD |
| Location API Route | GET/POST/PATCH/DELETE |
| 冻结字段 | name / description / environment / time / weather / color_style / fixed_prompt |
| 视觉风格页 | 单条记录 CRUD（项目级唯一） |
| Visual Style API Route | GET/POST/PATCH |
| 冻结字段 | name / camera_style / color / lighting / cinematography / fixed_prompt |

### Day 10：资产联调验证

| 任务 | 说明 |
|------|------|
| 三大资产端到端 | 创建项目 → 输入故事 → 建角色 → 建场景 → 建风格 |
| 数据校验 | fixed_prompt 正确保存，非空 |
| 空状态 | 列表页空数据引导文案 |

**里程碑**：三大资产可增删改查，fixed_prompt 正确保存。

---

## Week 3：AI 服务层（Phase 5）

### Day 11-12：AI 基础设施

| 任务 | 说明 |
|------|------|
| AI Provider 接口 | 定义统一接口 |
| DeepSeek 适配器 | 实现 chat 方法 |
| AIService 统一入口 | getAdapter + chat |
| error-handler | 重试（3次）+ 指数退避 + 超时（30s） |
| logger | 写入 ai_generations 表（成功/失败都写） |

**里程碑**：调用 AIService.chat() 可获得 AI 响应，失败时自动重试 + 记录日志。

### Day 13：角色提取 + 剧本生成

| 任务 | 说明 |
|------|------|
| generateCharacters() | Story → Characters[]（含 fixed_prompt） |
| generateScript() | Story + Characters + Style → Script JSON |
| Script API Route | POST 触发生成 |
| 剧本页面 | 展示 synopsis/characters/relationships/worldview/plot_outline |
| 保存到 scripts 表 | content JSONB |

**里程碑**：输入故事 + 资产后，可 AI 生成结构化剧本，角色自动提取。

### Day 14-15：分镜生成

| 任务 | 说明 |
|------|------|
| generateStoryboard() | Script → Episode/Scene/Shot |
| 自动建场景资产 | 新场景自动创建 Location 资产 |
| 镜头引用角色 | character_ids 关联 |
| 分镜页面 | Episode → Scene → Shot 三级列表 |
| Storyboard API Route | POST 触发生成 |
| 错误处理 | 遵循 AI错误处理规范.md，失败展示重试按钮 |

**里程碑**：可 AI 生成分镜，镜头引用正确的角色和场景。

---

## Week 4：Prompt Engine（Phase 6）

### Day 16-17：Prompt 生成核心

| 任务 | 说明 |
|------|------|
| ContextBuilder | 汇聚五重上下文（Story/Character/Location/Style/Shot） |
| TemplateAssembler | 组装 system + user prompt |
| OutputProcessor | 保存 prompts + prompt_versions + context_snapshot |
| generateImagePrompt() | shotId + platform + language → 图片 Prompt |
| generateVideoPrompt() | shotId + platform + language → 视频 Prompt |
| Prompt API Route | POST 触发生成 |
| 错误处理 | missing_data（无角色/无风格）+ API 失败重试 |

**里程碑**：选镜头 + 选平台 → 生成 Prompt → 正确保存（含 context_snapshot）。

### Day 18-19：Prompt 工作台页面

| 任务 | 说明 |
|------|------|
| Prompt 工作台 | 左侧镜头列表 + 右侧 Prompt 编辑区 |
| 平台选择 | 图片：即梦/MJ/Flux/ComfyUI；视频：可灵/Runway/LTX |
| 语言选择 | 中文 / 英文 |
| 复制按钮 | 复制到剪贴板 |
| 手动编辑 | 可编辑 AI 生成的 Prompt |
| 保存版本 | 保存为新的 prompt_version |
| Loading + Error | 生成中 spinner + 失败重试按钮 |

**里程碑**：Prompt 工作台完整可用。

### Day 20：全流程联调

| 任务 | 说明 |
|------|------|
| 端到端走通 | 创建项目 → 输入故事 → 建资产 → 生剧本 → 生分镜 → 生 Prompt → 复制 |
| 修 Bug | 修复联调发现的问题 |

**里程碑**：MVP 核心闭环全流程可走通。

---

## Week 5：优化测试 + 部署（Phase 7）

### Day 21-22：体验优化

| 任务 | 说明 |
|------|------|
| Loading 状态 | AI 生成按钮 spinner + 禁用 |
| Error 处理 | 按 AI错误处理规范.md 统一展示 + Toast |
| Toast 组件 | shadcn/ui Sonner |
| 空状态 | 列表页引导文案 |
| 确认弹窗 | 删除二次确认 |

### Day 23：版本管理 + 恢复

| 任务 | 说明 |
|------|------|
| Prompt 版本列表 | 查看历史版本 |
| 版本恢复 | 切换 is_current |
| context_snapshot 展示 | 可选：查看生成时的上下文快照 |

### Day 24：最终测试

| 任务 | 说明 |
|------|------|
| 全流程回归测试 | 从头到尾走一遍 |
| 边界测试 | 空数据 / 超长文本 / AI 失败重试 |
| RLS 验证 | 不同用户数据隔离 |

### Day 25：部署

| 任务 | 说明 |
|------|------|
| Vercel 部署 | 连接 Git repo + 配置环境变量 |
| Supabase 生产环境 | 确认 RLS 已启用 |
| 冒烟测试 | 生产环境走通核心流程 |

**里程碑**：MVP 上线，核心闭环可用。

---

## Phase → 周次映射

```
Phase 1（初始化）  ─┐
Phase 2（Supabase） ├─ Week 1
Phase 3（核心数据） ─┘
        ↓
Phase 4（资产 CRUD） ─── Week 2
        ↓
Phase 5（AI 服务层） ─── Week 3
        ↓
Phase 6（Prompt Engine） ─ Week 4
        ↓
Phase 7（体验优化）  ─── Week 5
```

## 依赖关系

```
Phase 1（项目骨架）
  ↓
Phase 2（数据库 + Auth）
  ↓
Phase 3（项目 + 故事）── 依赖 Phase 2 的数据库和 Auth
  ↓
Phase 4（资产 CRUD）── 依赖 Phase 3 的项目数据
  ↓
Phase 5（AI 服务层）── 依赖 Phase 4 的资产数据
  ↓
Phase 6（Prompt Engine）── 依赖 Phase 5 的分镜数据
  ↓
Phase 7（优化 + 部署）── 依赖 Phase 6 的全流程
```

> **任何一周延期，后续全部顺延。不可跳序。**
