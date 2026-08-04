# AI 短剧生产流程

> 全链路业务流程：故事→剧本→资产→分镜→Prompt。  
> 关联文档：[Prompt生成流程.md](./Prompt生成流程.md) | [一致性系统设计.md](./一致性系统设计.md)

---

## 全链路总览

```
阶段一  故事输入
  ↓
阶段二  剧本生成（generateScript）
  ↓
阶段三  创作资产建立（generateCharacters + 场景提取 + 风格选择）
  │     ├── 角色资产（Character）
  │     ├── 场景资产（Location）
  │     └── 视觉风格（Visual Style）
  ↓
阶段四  分镜生成（generateStoryboard）
  │     Episode → Scene → Shot
  ↓
阶段五  图片 Prompt（generateImagePrompt）
  │     引用：Shot + Character + Location + Style 上下文
  ↓
阶段六  视频 Prompt（generateVideoPrompt）
  ↓
阶段七  声音 Prompt（generateVoicePrompt）  [P1]
  ↓
阶段八  剪辑 Prompt（generateEditPrompt）    [P1]
  ↓
复制 → 第三方平台制作
```

---

## 阶段一：故事输入

**用户操作**：输入一句话故事或粘贴已有剧本。

**输入示例**：
```
林晚在婚礼当天被丈夫陈泽和闺蜜苏婉联手陷害，重生回到一年前，她决定让所有伤害过她的人付出代价。
```

**存储**：`stories` 表，`raw_input` 字段。

---

## 阶段二：剧本生成

**AI 方法**：`generateScript(storyInput, inputMode)`

**输入**：故事原文 + 输入方式（story / paste）

**AI 处理逻辑**：
1. 使用剧本 System Prompt 模板
2. 如果是 story 模式 → 扩写为完整剧本
3. 如果是 paste 模式 → 结构化整理
4. 输出 JSON

**输出结构**：
```json
{
  "synopsis": "林晚被害后重生回到一年前...",
  "genre": "复仇重生",
  "characters": [
    {
      "name": "林晚",
      "age": 25,
      "gender": "女",
      "personality": "冷静、坚韧、内心有强烈复仇意志",
      "background": "前世豪门少奶奶，被害后重生",
      "appearance": "长发、气质清冷、五官精致",
      "clothing": "白色婚纱（第一集）"
    },
    {
      "name": "陈泽",
      "age": 28,
      "gender": "男",
      "personality": "虚伪、阴狠",
      "background": "林晚丈夫，联合闺蜜陷害林晚",
      "appearance": "短发、西装、斯文败类气质"
    }
  ],
  "relationships": "林晚↔陈泽（前夫/仇人），林晚↔苏婉（前闺蜜/仇人）",
  "worldview": "现代都市豪门背景",
  "plot_outline": [
    { "episode": 1, "title": "雨夜重生", "summary": "林晚被害后重生回到一年前..." },
    { "episode": 2, "title": "布局开始", "summary": "林晚开始暗中布局复仇..." }
  ]
}
```

**保存方式**：`scripts` 表，characters/plot_outline 存为 jsonb。

---

## 阶段三：创作资产建立

> **V2 核心新增**：解决多镜头一致性问题。

**AI 方法**：`generateCharacters(script)` + 场景提取 + 风格选择

### 3.1 角色资产

**输入**：剧本中的 characters 列表

**AI 处理**：将剧本人物扩展为完整视觉资产，生成"固定视觉描述 Prompt"。

**输出**：每个角色生成一条 `characters` 记录：

```json
{
  "name": "林晚",
  "age": 25,
  "gender": "女",
  "face_shape": "瓜子脸",
  "hairstyle": "黑色长直发",
  "hair_color": "黑色",
  "body_type": "修长身材",
  "clothing_style": "白色婚纱/职业套装",
  "personality": "冷静、坚韧",
  "background": "重生复仇者",
  "visual_prompt": "25岁亚洲女性，黑色长直发，清冷五官，修长身材，电影写实风格",
  "reference_image_url": null
}
```

**关键**：`visual_prompt` 是固定视觉描述，所有引用该角色的镜头 Prompt 都包含此段。

### 3.2 场景资产

**输入**：剧本中的场景描述 + 分镜中的场景信息

**输出**：`locations` 记录：

```json
{
  "name": "医院门口",
  "location_type": "户外/建筑入口",
  "environment": "暴雨、霓虹灯倒影",
  "fixed_elements": "医院招牌灯光、水洼、雨幕",
  "time": "深夜",
  "weather": "暴雨",
  "color_tone": "冷青色",
  "layout": "远景医院建筑，近景门口台阶",
  "visual_prompt": "现代医院入口，深夜暴雨，霓虹灯倒影在水洼，冷青色调，电影氛围"
}
```

### 3.3 视觉风格

**输入**：用户选择或 AI 推荐

**输出**：`visual_styles` 记录：

```json
{
  "name": "都市复仇短剧风格",
  "photography_style": "电影摄影，低角度仰拍",
  "lens_language": "50mm，浅景深",
  "color_scheme": "冷蓝灰色调",
  "lighting": "高对比光影，体积光",
  "aspect_ratio": "16:9",
  "visual_references": "《黑暗荣耀》质感",
  "style_prompt": "都市复仇短剧风格，冷蓝灰色调，电影摄影，高对比光影，50mm镜头，16:9"
}
```

**保存方式**：`characters` / `locations` / `visual_styles` 表。

详见 [资产系统文档](../assets/)。

---

## 阶段四：分镜生成

**AI 方法**：`generateStoryboard(script, episodeNumber)`

**输入**：完整剧本 + 目标集数

**AI 处理**：拆解为 Episode → Scene → Shot 三级结构，每个 Shot 引用相关角色。

**输出结构**：
```json
{
  "scenes": [
    {
      "scene_number": 1,
      "location_name": "医院门口",
      "location_id": "uuid-of-location",
      "time": "雨夜",
      "weather": "暴雨",
      "shots": [
        {
          "shot_number": 1,
          "description": "女主站在医院门口，雨水打湿婚纱",
          "character_names": ["林晚"],
          "character_ids": ["uuid-of-linwan"],
          "action": "站立，抬头望向医院灯光",
          "emotion": "绝望、不甘",
          "environment": "暴雨、霓虹灯倒影",
          "cinematography": "中景，低角度仰拍，冷色调",
          "dialogue": ""
        }
      ]
    }
  ]
}
```

**保存方式**：`episodes` → `scenes`（引用 location_id）→ `shots`（引用 character_ids）。

---

## 阶段五：图片 Prompt 生成

**AI 方法**：`generateImagePrompt(shot, characters, location, visualStyle, platform, language)`

**输入**（Prompt Engine 五重上下文）：

| 上下文 | 来源 | 内容 |
|--------|------|------|
| Shot Context | shots 表 | 镜头描述/动作/情绪/摄影语言 |
| Character Context | characters 表 | 角色固定 visual_prompt |
| Location Context | locations 表 | 场景固定 visual_prompt |
| Style Context | visual_styles 表 | 风格固定 style_prompt |
| Platform Template | prompt_templates 表 | 平台格式规则 |

**AI 处理**：Prompt Engine 汇聚五重上下文 → 平台模板适配 → AI 生成。

**输出**（Midjourney 英文示例）：
```
A 25-year-old Asian woman, black long straight hair, cold delicate features, slender figure, 
wearing rain-soaked white wedding dress, standing at modern hospital entrance, heavy rain at night, 
neon light reflections in puddles, cold blue-grey tone, looking up at warm hospital lights, 
expression of despair turning to determination, medium shot, low angle, shallow depth of field, 
cinematic, high contrast lighting, 50mm lens, volumetric light, photorealistic 
--ar 16:9 --style raw --v 6
```

**保存方式**：`prompts` 表 + `prompt_versions` 版本链。

详见 [Prompt 生成架构](../prompt/Prompt生成架构.md)。

---

## 阶段六：视频 Prompt 生成

**AI 方法**：`generateVideoPrompt(shot, platform)`

**输出**（可灵AI 中文示例）：
```
镜头运动：镜头缓慢推进，从远景推至中景。
人物动作：女主缓慢抬头，雨水顺脸颊滑落，眼神从绝望转为坚定。
环境变化：暴雨持续，远处闪电闪烁，霓虹灯光随雨水流动产生折射光斑。
视频参数：时长5秒，16:9比例，电影感风格，24fps，冷色调。
```

---

## 阶段七：声音 Prompt 生成 [P1]

**AI 方法**：`generateVoicePrompt(shot, character, platform)`

**输出**：
```
角色：林晚
声音类型：25岁女性
音色：低沉、冷静、略带沙哑
情绪：压抑的愤怒，带有复仇决心
语速：偏慢，每句结尾有停顿
对白风格：简短有力，不啰嗦，带冷笑
```

---

## 阶段八：剪辑 Prompt 生成 [P1]

**AI 方法**：`generateEditPrompt(episodeId, shots[])`

**输出**：
```
镜头排序：S1-1 → S1-2 → S1-3（按时间线推进）
字幕建议：简洁白字，底部居中，复仇独白用斜体
BGM建议：低沉弦乐开场，雷雨音效贯穿，高潮段落加入鼓点
转场建议：镜头间硬切保持紧张感，场景转换用雨声叠化
```

---

## 流程特点

| 特点 | 说明 |
|------|------|
| 资产前置 | 阶段三资产建立是阶段五-七 Prompt 生成的依赖 |
| 上下文驱动 | Prompt Engine 汇聚五重上下文，而非简单拼接 |
| 可回退 | 修改资产后可重新生成下游 Prompt |
| 可重生成 | 每个阶段输出可重新生成，保留版本 |
