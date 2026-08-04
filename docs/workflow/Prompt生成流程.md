# Prompt 生成流程

> 上下文驱动 Prompt Engine 的执行流程。  
> 关联文档：[AI短剧生产流程.md](./AI短剧生产流程.md) | [../prompt/Prompt生成架构.md](../prompt/Prompt生成架构.md)

---

## Prompt Engine 架构

```
┌─────────────────────────────────────────────┐
│              Prompt Engine                   │
├─────────────────────────────────────────────┤
│  输入上下文（Context Builder 汇聚）           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Story   │ │Character│ │Location │        │
│  │ Context │ │ Context │ │ Context │        │
│  └─────────┘ └─────────┘ └─────────┘        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Visual  │ │ Shot    │ │Platform │        │
│  │ Style   │ │ Context │ │Template │        │
│  └─────────┘ └─────────┘ └─────────┘        │
├─────────────────────────────────────────────┤
│  System Prompt 组装                         │
│  = 平台规则 + 资产固定 Prompt + 上下文拼接   │
├─────────────────────────────────────────────┤
│  AI 模型调用（DeepSeek/Claude/Kimi/豆包）     │
├─────────────────────────────────────────────┤
│  输出：结构化 Prompt 文本                    │
│  → 保存到 prompts + prompt_versions          │
└─────────────────────────────────────────────┘
```

---

## 七大生成能力

### 1. generateScript()

| 项 | 说明 |
|----|------|
| **输入数据** | 故事原文（storyInput）+ 输入方式（story/paste） |
| **AI 处理逻辑** | story 模式扩写剧本；paste 模式结构化整理。输出 JSON |
| **输出结构** | synopsis / genre / characters[] / relationships / worldview / plot_outline[] |
| **保存方式** | scripts 表，characters/plot_outline 存 jsonb |

### 2. generateCharacters()

| 项 | 说明 |
|----|------|
| **输入数据** | 剧本中的 characters 列表 + genre |
| **AI 处理逻辑** | 将剧本人物扩展为完整视觉资产，为每个角色生成固定 visual_prompt |
| **输出结构** | name / age / gender / face_shape / hairstyle / hair_color / body_type / clothing_style / personality / background / visual_prompt |
| **保存方式** | characters 表，每角色一条记录 |

### 3. generateStoryboard()

| 项 | 说明 |
|----|------|
| **输入数据** | 完整剧本 + 已有角色/场景资产 + 目标集数 |
| **AI 处理逻辑** | 拆解 Episode→Scene→Shot，每个 Shot 引用角色 ID 和场景 ID |
| **输出结构** | scenes[]，每个 scene 含 shots[]，shot 含 character_ids + location_id |
| **保存方式** | episodes → scenes → shots 三表级联写入 |

### 4. generateImagePrompt()

| 项 | 说明 |
|----|------|
| **输入数据** | Shot + 引用的 Character(s) + Location + VisualStyle + platform + language |
| **AI 处理逻辑** | Context Builder 汇聚五重上下文 → 平台模板组装 System Prompt → AI 生成 |
| **输出结构** | 结构化 Prompt 文本（含人物/场景/动作/摄影/风格五维度） |
| **保存方式** | prompts 表（prompt_type='image'）+ prompt_versions 版本链 |

### 5. generateVideoPrompt()

| 项 | 说明 |
|----|------|
| **输入数据** | Shot + 图片描述（如有）+ platform |
| **AI 处理逻辑** | 根据镜头信息生成运动描述：镜头运动/人物动作/环境变化/视频参数 |
| **输出结构** | 运动描述 Prompt 文本 |
| **保存方式** | prompts 表（prompt_type='video'）+ prompt_versions |

### 6. generateVoicePrompt()

| 项 | 说明 |
|----|------|
| **输入数据** | Shot + Character（含声音特征）+ platform |
| **AI 处理逻辑** | 根据角色资产 + 镜头情绪生成声音描述 |
| **输出结构** | 声音类型/音色/情绪/语速/对白风格 |
| **保存方式** | prompts 表（prompt_type='voice'）+ prompt_versions |

### 7. generateEditPrompt()

| 项 | 说明 |
|----|------|
| **输入数据** | 某集所有 shots + episodeId |
| **AI 处理逻辑** | 根据镜头序列生成剪辑建议 |
| **输出结构** | 镜头排序/字幕/BGM/转场建议 |
| **保存方式** | prompts 表（prompt_type='edit'，关联 episode_id 而非 shot_id） |

---

## Context Builder 详解

Context Builder 是 Prompt Engine 的核心组件，负责从数据库汇聚五重上下文。

```typescript
interface PromptContext {
  story: {
    synopsis: string;
    genre: string;
    worldview: string;
  };
  characters: Character[];      // 从 shots.character_ids 查询
  location: Location;           // 从 scenes.location_id 查询
  visualStyle: VisualStyle;     // 从 projects 关联
  shot: Shot;                   // 当前镜头
  platform: Platform;           // 目标平台
  language: 'zh' | 'en';
}
```

### 上下文汇聚流程

```
1. 查询 shot（含 character_ids, scene_id）
2. 通过 scene_id 查询 scene → 获取 location_id
3. 通过 location_id 查询 location 资产
4. 通过 character_ids 查询 character 资产列表
5. 通过 project_id 查询关联的 visual_style
6. 通过 project_id 查询 story
7. 通过 platform 查询 prompt_template
8. 组装完整上下文 → 生成 System Prompt + User Prompt
```

---

## 版本管理机制

```
prompts（逻辑记录，一个 shot+type+platform+language 一条）
  └── prompt_versions（物理版本，每次生成/编辑一条）
        ├── version 1（AI 原始生成）
        ├── version 2（用户编辑后保存）
        └── version 3（重新 AI 生成）
              ↑ current
```

| 操作 | 行为 |
|------|------|
| AI 生成 | 新建 prompt_versions，标记 current |
| 用户编辑保存 | 新建 prompt_versions，旧版本保留，新版本标记 current |
| 查看历史 | 查询某 prompt 的所有 versions |
| 恢复版本 | 将目标 version 标记为 current |

---

## 生成失败处理

| 场景 | 处理 |
|------|------|
| AI API 超时 | 返回 504，前端显示重试按钮 |
| AI 返回非 JSON | 尝试提取 JSON 片段，失败则返回原始文本 |
| API Key 无效 | 返回 500，提示配置错误 |
| 上下文缺失（资产未建立） | 返回 400，提示先建立资产 |
