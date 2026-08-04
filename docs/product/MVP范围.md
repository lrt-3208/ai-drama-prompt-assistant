# MVP 功能范围划分

> 按优先级 P0/P1/P2 划分功能范围。  
> 关联文档：[PRD.md](./PRD.md) | [产品路线图.md](./产品路线图.md)

---

## P0 — 第一版必须实现

P0 是 MVP 核心闭环，必须全部完成才能发布。

| 功能 | 模块 | 说明 |
|------|------|------|
| 用户注册/登录 | 用户 | 邮箱密码，Supabase Auth |
| 项目管理 | 项目 | 创建/编辑/删除/列表 |
| 故事输入 | 故事 | 一句话故事或粘贴剧本 |
| AI 剧本生成 | 剧本 | generateScript() 结构化输出 |
| **角色资产管理** | 资产中心 | Character CRUD + 固定视觉描述 Prompt |
| **场景资产管理** | 资产中心 | Location CRUD + 固定场景 Prompt |
| **视觉风格管理** | 资产中心 | Visual Style CRUD + 固定 Style Prompt |
| AI 分镜生成 | 分镜 | Episode→Scene→Shot 三级拆解 |
| **图片 Prompt 生成** | Prompt | Prompt Engine 上下文驱动，4 平台 ×2 语言 |
| **视频 Prompt 生成** | Prompt | 3 平台视频运动 Prompt |
| Prompt 复制 | Prompt | 一键复制到剪贴板 |
| 资产引用 | 资产 | 图片/视频 Prompt 自动引用角色+场景+风格 |

**P0 核心闭环**：故事输入 → 剧本 → 资产建立 → 分镜 → 图片/视频 Prompt → 复制

---

## P1 — 增强功能

P1 在 P0 基础上增强 Prompt 覆盖面和版本管理能力。

| 功能 | 模块 | 说明 |
|------|------|------|
| 声音 Prompt 生成 | Prompt | 2 平台角色音色描述 |
| 剪辑 Prompt 生成 | Prompt | 镜头排序/BGM/转场建议 |
| Prompt 模板系统 | Prompt | prompt_templates 表，9 大平台模板 |
| Prompt 版本管理 | Prompt | prompt_versions 独立表，历史版本查看/恢复 |
| 平台适配增强 | Prompt | 平台模板可配置，新增平台不改代码 |
| 镜头手动编辑 | 分镜 | 编辑镜头各字段，重新生成单个镜头 |
| AI 模型切换 | AI | 生成时选择 DeepSeek/Claude/Kimi/豆包 |
| 导出功能 | 导出 | 导出全套 Prompt 为文本/JSON |

---

## P2 — 长期规划

P2 为未来版本，当前架构已预留扩展点。

| 功能 | 说明 |
|------|------|
| 图片 API 自动生成 | 接入即梦/MJ/Flux/ComfyUI 生成 API |
| 视频 API 自动生成 | 接入可灵/Runway/LTX 生成 API |
| TTS 自动合成 | 接入豆包TTS/Qwen-TTS 合成 API |
| 素材管理 | 生成图片/视频/音频存储到 Supabase Storage |
| AI 导演 Agent | 自动编排全套短剧生产流程 |
| 一键生成完整短剧 | 输入故事 → 自动完成全链路 |
| 团队协作 | 多用户协作 |
| 付费体系 | 会员/积分制 |

---

## 优先级矩阵

```
紧急度高 ────────────────────── 紧急度低
  │  P0（必须）  │  P1（增强）  │  P2（长期）
  │  核心闭环    │  版本管理    │  AI 自动生成
  │  Prompt生成  │  模板系统    │  素材管理
  │  资产中心    │  平台适配    │  AI Agent
  │  剧本/分镜   │  导出       │  协作/付费
```

## 实现建议

- P0 内部串行依赖：认证 → 项目 → 故事 → 剧本 → 资产 → 分镜 → Prompt
- P1 可与 P0 后期并行开发（版本管理、模板系统独立性强）
- P2 严格依赖 P0/P1 完成，且需要第三方 API 接入
