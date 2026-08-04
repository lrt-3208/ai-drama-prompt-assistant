# AI 短剧 Prompt 助手 — 工程文档体系

> **版本**：v2.0（架构升级版）  
> **技术栈**：Next.js + TypeScript + Tailwind CSS + shadcn/ui + Supabase + Vercel  
> **文档目标**：可直接交付 AI Coding Agent 开发完整 Next.js + TypeScript + Supabase + Vercel 项目

---

## 文档体系总览

本体系按模块化拆分，每个文档职责单一、可独立迭代。AI Coding Agent 可按目录顺序阅读后直接生成代码。

```
docs/
├── README.md                          ← 本文件（导航 + 阅读指南）
├── product/                           ← 产品定义层
│   ├── PRD.md                         产品需求文档（定位/价值/目标/非目标）
│   ├── MVP范围.md                     P0/P1/P2 功能范围划分
│   ├── 用户流程.md                     端到端用户使用流程
│   └── 产品路线图.md                   V1→V5 版本演进规划
├── workflow/                          ← 工作流设计层
│   ├── AI短剧生产流程.md               故事→剧本→资产→分镜→Prompt 全链路
│   ├── Prompt生成流程.md               上下文驱动 Prompt Engine 执行流程
│   └── 一致性系统设计.md               多镜头一致性解决方案
├── assets/                            ← 创作资产系统
│   ├── 角色资产系统.md                 Character 资产字段与引用
│   ├── 场景资产系统.md                 Location 资产字段与引用
│   ├── 视觉风格资产系统.md             Visual Style 资产字段与引用
│   └── 资产引用机制.md                 资产如何被 Prompt Engine 引用
├── prompt/                            ← Prompt 规范层
│   ├── Prompt生成架构.md               Prompt Engine 架构设计
│   ├── 图片Prompt规范.md               图片 Prompt 结构与字段
│   ├── 视频Prompt规范.md               视频 Prompt 结构与字段
│   ├── 声音Prompt规范.md               声音 Prompt 结构与字段
│   ├── 剪辑Prompt规范.md               剪辑 Prompt 结构与字段
│   └── 平台适配模板.md                 9大平台模板规则
├── database/                          ← 数据库设计层
│   ├── Supabase数据库设计.md           全部建表 SQL
│   ├── 数据关系设计.md                 ER 关系与级联说明
│   └── RLS权限设计.md                  行级安全策略
├── architecture/                      ← 系统架构层
│   ├── 系统架构.md                     整体架构与分层
│   ├── AI服务层设计.md                 AIService + Provider 适配器
│   └── 后端接口设计.md                 API Route 完整设计
├── frontend/                          ← 前端设计层
│   ├── 页面设计.md                     路由与页面布局
│   ├── 组件设计.md                     React 组件树设计
│   └── UI规范.md                       设计规范与主题
└── development/                       ← 开发执行层
    ├── 开发计划.md                     P0/P1/P2 迭代计划
    ├── Task拆解.md                     可执行任务清单
    └── AI Coding Agent开发规范.md      AI 编码约定
```

---

## AI Coding Agent 阅读顺序

```
1. product/PRD.md              → 理解产品定位与边界
2. product/MVP范围.md           → 确认当前实现哪些功能
3. workflow/AI短剧生产流程.md    → 理解全链路业务逻辑
4. workflow/一致性系统设计.md    → 理解核心难点：一致性
5. assets/*.md                  → 理解三大资产数据结构
6. database/Supabase数据库设计.md → 建表
7. database/RLS权限设计.md       → 配置安全策略
8. architecture/系统架构.md      → 理解分层
9. architecture/AI服务层设计.md   → 实现 AI 调用
10. prompt/Prompt生成架构.md     → 实现 Prompt Engine
11. prompt/平台适配模板.md       → 实现平台适配
12. architecture/后端接口设计.md  → 实现 API
13. frontend/页面设计.md         → 实现页面
14. frontend/组件设计.md         → 实现组件
15. development/Task拆解.md      → 按任务执行
```

---

## V1 → V2 架构升级要点

| 维度 | V1（原版） | V2（升级版） |
|------|-----------|-------------|
| 文档结构 | 单文件 PRD | 模块化 docs/ 体系 |
| 项目模型 | Project→Script→Episode→Scene→Shot→Prompt | Project→Story→Assets(角色/场景/风格)→Script→Episode→Scene→Shot→Prompt |
| 一致性 | 无 | 创作资产中心 + 资产引用机制 |
| Prompt 生成 | 简单函数 generateXxxPrompt() | 上下文驱动 Prompt Engine（Story+Character+Location+Style+Shot Context） |
| Prompt 模板 | 内嵌字符串 | 独立 prompt_templates 表 + 平台适配模板系统 |
| 版本管理 | prompts.is_current 标记 | prompt_versions 独立表，完整版本链 |
| 数据表 | 7 张 | 14 张（新增 stories/characters/locations/visual_styles/prompt_templates/prompt_versions/ai_generations） |
| MVP 划分 | 4 阶段线性 | P0/P1/P2 优先级分级 |
| 页面结构 | 剧本/分镜/Prompt 三标签页 | 项目首页/剧本/资产中心/分镜/Prompt工作台/导出 |

---

## 关键设计原则

1. **Prompt 是终点，不是媒体**：MVP 不调用图片/视频/TTS 生成 API，只输出可复制 Prompt
2. **一致性是核心价值**：通过创作资产中心让角色/场景/风格在多镜头间保持一致
3. **上下文驱动**：Prompt Engine 接收 Story+Character+Location+Style+Shot 五重上下文
4. **平台可扩展**：新增平台只需加模板，不改核心逻辑
5. **模型可替换**：AI Provider 适配器模式，DeepSeek/Claude/Kimi/豆包 自由切换
6. **文档工程化**：每个文档职责单一，方便 AI Coding Agent 定位和执行
