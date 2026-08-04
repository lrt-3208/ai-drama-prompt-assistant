# Prompt 生成架构

> 上下文驱动 Prompt Engine 完整架构设计。  
> 关联文档：[../architecture/AI服务层设计.md](../architecture/AI服务层设计.md) | [平台适配模板.md](./平台适配模板.md)

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                  Prompt Engine                        │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────┐    ┌──────────────────────┐        │
│  │ Context      │    │ Prompt Template      │        │
│  │ Builder      │───→│ Assembler            │        │
│  │ (汇聚上下文)  │    │ (组装 System Prompt) │        │
│  └──────┬──────┘    └──────────┬───────────┘        │
│         │                      │                     │
│  五重上下文              组装后的 Prompt              │
│  • Story                 ↓                             │
│  • Character[]      ┌──────────────┐                  │
│  • Location         │  AI Model    │                  │
│  • VisualStyle      │  Adapter     │                  │
│  • Shot             │  (调用AI)    │                  │
│                      └──────┬───────┘                  │
│                             │                          │
│                      ┌──────▼───────┐                  │
│                      │  Output      │                  │
│                      │  Processor   │                  │
│                      │  (解析+保存)  │                  │
│                      └──────────────┘                  │
│                                                       │
└─────────────────────────────────────────────────────┘
```

---

## 核心组件

### 1. Context Builder（上下文汇聚器）

从数据库查询并汇聚五重上下文。

```typescript
// lib/ai/context-builder.ts

class ContextBuilder {
  constructor(private supabase: SupabaseClient) {}

  async buildImagePromptContext(
    shotId: string,
    platform: Platform,
    language: 'zh' | 'en'
  ): Promise<PromptContext> {
    // 1. 查询 shot
    const shot = await this.getShot(shotId);
    // 2. 查询 scene → location
    const scene = await this.getScene(shot.scene_id);
    const location = await this.getLocation(scene.location_id);
    // 3. 查询 characters
    const characters = await this.getCharacters(shot.character_ids);
    // 4. 查询 project → visual_style
    const project = await this.getProject(shot.project_id);
    const visualStyle = await this.getVisualStyle(project.visual_style_id);
    // 5. 查询 story
    const story = await this.getStory(shot.project_id);
    // 6. 查询 platform template
    const template = await this.getTemplate(platform, 'image', language);

    return { story, characters, location, visualStyle, shot, platform, language, template };
  }
}
```

### 2. Prompt Template Assembler（模板组装器）

将上下文 + 平台模板组装为 System Prompt + User Prompt。

```typescript
// lib/ai/template-assembler.ts

class TemplateAssembler {
  assembleImagePrompt(ctx: PromptContext): { system: string; user: string } {
    const system = [
      ctx.template.system_rule,                    // 平台规则
      `角色描述（固定不变）：${ctx.characters.map(c => c.visual_prompt).join('；')}`,
      `场景描述（固定不变）：${ctx.location.visual_prompt}`,
      `视觉风格（固定不变）：${ctx.visualStyle.style_prompt}`,
    ].join('\n');

    const user = [
      `镜头编号：${ctx.shot.shot_number}`,
      `动作：${ctx.shot.action}`,
      `情绪：${ctx.shot.emotion}`,
      `摄影语言：${ctx.shot.cinematography}`,
      `镜头级环境（可覆盖场景默认）：${ctx.shot.environment}`,
      `请生成${ctx.language === 'zh' ? '中文' : '英文'}图片Prompt，适配${ctx.platform}平台格式。`,
    ].join('\n');

    return { system, user };
  }
}
```

### 3. AI Model Adapter（AI 模型适配器）

统一调用不同 AI 模型，详见 [AI服务层设计](../architecture/AI服务层设计.md)。

### 4. Output Processor（输出处理器）

解析 AI 返回，保存到数据库。

```typescript
class OutputProcessor {
  async savePrompt(params: SavePromptParams): Promise<Prompt> {
    // 1. 查询或创建 prompts 逻辑记录
    let prompt = await this.findOrCreatePrompt({
      shot_id, prompt_type, platform, language
    });
    // 2. 取当前版本号 +1
    const versionNumber = await this.getNextVersionNumber(prompt.id);
    // 3. 旧版本取消 current
    await this.unsetCurrentVersions(prompt.id);
    // 4. 创建新版本
    await this.createVersion({
      prompt_id: prompt.id,
      content: params.content,
      version_number: versionNumber,
      is_current: true,
    });
    return prompt;
  }
}
```

---

## 七大能力方法签名

```typescript
class PromptEngine {
  // 剧本生成
  async generateScript(params: ScriptGenerationParams): Promise<Script>;
  // 角色资产提取
  async generateCharacters(script: Script): Promise<Character[]>;
  // 分镜生成
  async generateStoryboard(params: StoryboardParams): Promise<Scene[]>;
  // 图片 Prompt 生成（上下文驱动）
  async generateImagePrompt(shotId: string, platform: Platform, language: 'zh' | 'en'): Promise<string>;
  // 视频 Prompt 生成
  async generateVideoPrompt(shotId: string, platform: Platform): Promise<string>;
  // 声音 Prompt 生成 [P1]
  async generateVoicePrompt(shotId: string, platform: Platform): Promise<string>;
  // 剪辑 Prompt 生成 [P1]
  async generateEditPrompt(episodeId: string): Promise<string>;
}
```

---

## 数据流

```
用户请求
  ↓
API Route（鉴权）
  ↓
Service 层（业务逻辑）
  ↓
PromptEngine.generateImagePrompt(shotId, platform, language)
  ↓
ContextBuilder.buildImagePromptContext(shotId, ...)
  ↓ [查询 5 重上下文]
TemplateAssembler.assembleImagePrompt(ctx)
  ↓ [组装 system + user prompt]
AIProviderAdapter.chat({ system, user })
  ↓ [调用 AI API]
OutputProcessor.savePrompt({ content, ... })
  ↓ [保存 prompts + prompt_versions]
返回 Prompt 内容
```

---

## 扩展性设计

| 扩展点 | 方案 |
|--------|------|
| 新增 AI 模型 | 新增 ProviderAdapter 实现 |
| 新增平台 | 新增 prompt_templates 记录 |
| 新增 Prompt 类型 | 新增 prompt_type 枚举 + 模板 |
| 接入图片/视频生成 | PromptEngine 新增 generateImage/Video 方法 |
| 自定义模板 | 用户可编辑 prompt_templates |
