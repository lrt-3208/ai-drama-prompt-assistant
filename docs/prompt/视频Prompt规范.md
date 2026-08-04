# 视频 Prompt 规范

> 视频 Prompt 的结构化字段与输出规范。  
> 关联文档：[Prompt生成架构.md](./Prompt生成架构.md) | [平台适配模板.md](./平台适配模板.md)

---

## Prompt 结构

视频 Prompt 描述**画面运动**，包含四个维度：

| 维度 | 字段 |
|------|------|
| 镜头运动 | 推进/拉远/旋转/平移/固定 |
| 人物动作 | 走动/转身/表情变化/微动作 |
| 环境变化 | 雨雪/风/光影变化/烟雾 |
| 视频参数 | 时长/比例/风格/帧率 |

---

## 输出示例

### 可灵AI（中文）

```
镜头运动：镜头缓慢推进（dolly in），从远景逐渐推至中景，保持画面稳定。
人物动作：女主缓慢抬头，雨水顺着脸颊滑落，眼神从绝望逐渐转为坚定，嘴角微微抿紧。
环境变化：暴雨持续不断，远处偶尔闪电闪烁，霓虹灯光随雨水流动产生折射光斑，水洼泛起涟漪。
视频参数：时长5秒，16:9比例，电影感风格，24fps帧率，冷色调，高对比度。
```

### Runway（英文）

```
Camera movement: slow dolly in from wide shot to medium shot, smooth and steady.
Character action: woman slowly raises her head, rain running down her face, expression transitioning from despair to determination, lips tightening slightly.
Environment: heavy rain continues, distant lightning flashes, neon lights creating colorful reflections and refractions in flowing water, ripples in puddles.
Parameters: 5 seconds, 16:9, cinematic style, 24fps, cold tone, high contrast.
```

### LTX（英文，简洁运动描述）

```
Slow camera push-in from wide to medium. Woman raises head in rain, expression shifting from despair to resolve. Heavy rain, lightning in distance, neon reflections in puddles. 5s, 16:9, cinematic.
```

---

## 平台适配规则

| 平台 | 语言 | 风格 | 说明 |
|------|------|------|------|
| 可灵AI | 中文 | 详细运动描述 | 段落式，分维度描述 |
| Runway | 英文 | 结构化运动描述 | Motion Brush 风格 |
| LTX | 英文 | 简洁运动描述 | 一段式精简 |

---

## 上下文依赖

| 上下文 | 用途 |
|--------|------|
| Shot（镜头信息） | 动作/情绪/摄影语言 → 转化为运动描述 |
| 图片 Prompt（如有） | 静态画面 → 推导运动方向 |
| Character | 人物动作合理性约束 |
| Location | 环境变化（雨/风/光影） |

> 视频 Prompt 不强制引用角色/场景固定描述（运动描述为主），但人物动作需与角色一致。
