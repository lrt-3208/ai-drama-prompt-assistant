# UI 规范

> 设计规范与主题配置。  
> 关联文档：[页面设计.md](./页面设计.md) | [组件设计.md](./组件设计.md)

---

## 技术选型

| 项 | 选型 |
|----|------|
| UI 框架 | shadcn/ui |
| 样式 | Tailwind CSS |
| 图标 | lucide-react |
| 主题 | 深色/浅色模式 |
| 字体 | 系统默认 + 中文优化 |

---

## 主题配置

```css
/* globals.css */
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --primary: 240 5.9% 10%;
  --secondary: 240 4.8% 95.9%;
  --muted: 240 4.8% 95.9%;
  --accent: 240 4.8% 95.9%;
  --border: 240 5.9% 90%;
  --radius: 0.5rem;
}

.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --primary: 0 0% 98%;
  --secondary: 240 3.7% 15.9%;
  --muted: 240 3.7% 15.9%;
  --accent: 240 3.7% 15.9%;
  --border: 240 3.7% 15.9%;
}
```

---

## 布局规范

| 规范 | 值 |
|------|-----|
| 最小宽度 | 1024px（桌面端优先） |
| 最大内容宽度 | 1280px |
| 侧边栏宽度 | 320px（Prompt 工作台左侧） |
| 卡片间距 | gap-4 (16px) |
| 页面内边距 | p-6 (24px) |

---

## 组件规范

| 组件 | 规范 |
|------|------|
| 按钮 | primary（实心）/ secondary（描边）/ ghost（透明）/ destructive（红色） |
| 卡片 | rounded-lg border shadow-sm p-4 |
| 输入框 | h-10 rounded-md border px-3 |
| 标签页 | shadcn Tabs 组件 |
| 弹窗 | shadcn Dialog 组件 |
| 下拉选择 | shadcn Select 组件 |
| Toast | shadcn Toast，右上角，3 秒自动消失 |
| 加载态 | Skeleton 占位 或 Spinner |
| 空状态 | 居中图标 + 文案 + 行动按钮 |

---

## 状态设计

| 状态 | 视觉 | 说明 |
|------|------|------|
| Loading | Skeleton / Spinner | AI 生成时显示 |
| Empty | 图标 + "暂无数据" | 无项目/无镜头时 |
| Error | 红色提示 + 重试按钮 | 生成失败时 |
| Success | 绿色 Toast | 复制/保存成功 |

---

## 项目状态标签颜色

| 状态 | 颜色 | 说明 |
|------|------|------|
| draft | gray | 草稿 |
| scripting | blue | 剧本生成中 |
| asset_building | purple | 资产建立中 |
| storyboarding | amber | 分镜生成中 |
| prompting | cyan | Prompt 生成中 |
| completed | green | 已完成 |
| deleted | red | 已删除 |

---

## 响应式

MVP 桌面端优先，不做移动端适配。最小适配宽度 1024px。

---

## 代码风格

- 组件文件名：PascalCase（`ProjectCard.tsx`）
- 组件 props 接口：`XxxProps`（`ProjectCardProps`）
- 使用 `cn()` 合并 className
- 服务端组件默认，交互组件加 `"use client"`
