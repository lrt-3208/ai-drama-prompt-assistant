# 图片 Prompt 规范

> 图片 Prompt 的结构化字段与输出规范。  
> 关联文档：[Prompt生成架构.md](./Prompt生成架构.md) | [平台适配模板.md](./平台适配模板.md)

---

## Prompt 结构

图片 Prompt 包含五个维度，由 Prompt Engine 上下文驱动生成：

| 维度 | 来源 | 字段 |
|------|------|------|
| 人物 | Character 资产 | 年龄/性别/脸型/发型/发色/身材/服装 |
| 场景 | Location 资产 | 地点/时间/天气/环境/色调 |
| 动作 | Shot 上下文 | 人物动作/表情 |
| 摄影 | Shot 上下文 | 景别/角度/焦距/景深/构图 |
| 风格 | VisualStyle 资产 | 色调/光影/摄影风格/画面比例 |

---

## 上下文注入规则

```
[角色固定 visual_prompt]  ← Character.visual_prompt（不变）
+
[场景固定 visual_prompt]  ← Location.visual_prompt（不变）
+
[风格固定 style_prompt]   ← VisualStyle.style_prompt（不变）
+
[镜头级动态信息]          ← Shot.action/emotion/cinematography/environment（可变）
+
[平台格式规则]            ← prompt_template（平台适配）
```

---

## 输出示例

### 即梦AI（中文）

```
人物：25岁亚洲女性，瓜子脸，黑色长直发，清冷五官，修长身材，身穿被雨水打湿的白色婚纱，表情绝望而不甘，眼神坚定。
场景：现代医院入口，深夜暴雨，霓虹灯倒影在水洼中，医院招牌灯光，冷青色调，电影氛围。
动作：站立，微微抬头望向医院温暖灯光。
摄影：中景构图，低角度仰拍，浅景深，焦距50mm，画面有雨丝动感。
风格：都市复仇短剧风格，冷蓝灰色调，电影摄影，高对比光影，体积光，16:9。
```

### Midjourney（英文）

```
A 25-year-old Asian woman, oval face, black long straight hair, cold delicate features, slender figure, wearing rain-soaked white wedding dress, standing at modern hospital entrance, heavy rain at night, neon light reflections in puddles, cold blue-grey tone, looking up at warm hospital lights, expression of despair turning to determination, medium shot, low angle, shallow depth of field, 50mm lens, cinematic, high contrast lighting, volumetric light, photorealistic, urban revenge drama style --ar 16:9 --style raw --v 6
```

### Flux（英文，自然语言长描述）

```
A cinematic photograph of a 25-year-old Asian woman with an oval face, long straight black hair, and cold delicate features. She has a slender figure and wears a rain-soaked white wedding dress. She stands at the entrance of a modern hospital on a stormy night, heavy rain pouring down, neon lights reflecting in puddles on the ground, hospital sign glowing warm against the cold blue-grey atmosphere. She looks up at the warm hospital lights with an expression of despair transitioning to determination. Medium shot, low angle, shallow depth of field, 50mm lens, high contrast lighting with volumetric light effects, photorealistic urban revenge drama style, 16:9 aspect ratio.
```

### ComfyUI（英文 + negative prompt + 权重）

```
Positive: (25-year-old Asian woman:1.2), (oval face:1.1), (black long straight hair:1.2), (cold delicate features:1.1), (slender figure:1.0), (rain-soaked white wedding dress:1.3), (modern hospital entrance:1.2), (heavy rain at night:1.3), (neon light reflections in puddles:1.1), (cold blue-grey tone:1.2), (looking up at warm lights:1.0), (despair to determination:1.1), (medium shot:1.0), (low angle:1.1), (shallow depth of field:1.0), (50mm lens:1.0), (cinematic:1.2), (high contrast lighting:1.1), (volumetric light:1.2), (photorealistic:1.3)

Negative: (cartoon:1.5), (anime:1.5), (deformed:1.5), (extra fingers:1.5), (blurry:1.3), (bad anatomy:1.4), (watermark:1.5), (text:1.3), (low quality:1.4)
```

---

## 平台 × 语言矩阵

| 平台 | 中文 | 英文 | 默认 |
|------|------|------|------|
| 即梦AI | ✅ | ✅ | 中文 |
| Midjourney | — | ✅ | 英文 |
| Flux | — | ✅ | 英文 |
| ComfyUI | — | ✅ | 英文 |

---

## 质量要求

| 要求 | 说明 |
|------|------|
| 角色描述完整 | 必须包含角色 visual_prompt 全部内容 |
| 场景描述完整 | 必须包含场景 visual_prompt 全部内容 |
| 风格描述完整 | 必须包含 style_prompt 全部内容 |
| 镜头摄影专业 | 使用专业景别/角度/焦距术语 |
| 平台格式正确 | MJ 参数、ComfyUI 权重语法等 |
| 无多余信息 | 不包含与画面无关的叙事性描述 |
