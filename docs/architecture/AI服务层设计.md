# AI 服务层设计

> AIService + Provider 适配器模式。  
> 关联文档：[../prompt/Prompt生成架构.md](../prompt/Prompt生成架构.md)

---

## 设计目标

- 统一 AI 调用接口，底层支持切换不同模型
- 新增模型只需新增适配器，不改业务逻辑
- Prompt Engine 通过 AIService 调用，不直接接触具体 API

---

## 架构

```
PromptEngine
  ↓
AIService（统一入口）
  ↓
AIProviderAdapter（适配器接口）
  ├── DeepSeekAdapter
  ├── ClaudeAdapter
  ├── KimiAdapter
  └── DoubaoAdapter
```

---

## 类型定义

```typescript
// lib/ai/types.ts

type AIProvider = 'deepseek' | 'claude' | 'kimi' | 'doubao';

interface AICallParams {
  provider: AIProvider;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;  // 默认 0.7
  maxTokens?: number;     // 默认 4096
  responseFormat?: 'text' | 'json';  // JSON 模式
}

interface AICallResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
}
```

---

## Provider 适配器接口

```typescript
// lib/ai/providers/base.ts

interface AIProviderAdapter {
  chat(params: AICallParams): Promise<AICallResult>;
}
```

---

## DeepSeek 适配器

```typescript
// lib/ai/providers/deepseek.ts

class DeepSeekAdapter implements AIProviderAdapter {
  async chat(params: AICallParams): Promise<AICallResult> {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        response_format: params.responseFormat === 'json' ? { type: 'json_object' } : undefined,
      }),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: 'deepseek-chat',
    };
  }
}
```

---

## Claude 适配器

```typescript
// lib/ai/providers/claude.ts

class ClaudeAdapter implements AIProviderAdapter {
  async chat(params: AICallParams): Promise<AICallResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: params.maxTokens ?? 4096,
        system: params.systemPrompt,
        messages: [{ role: 'user', content: params.userPrompt }],
      }),
    });
    // ...解析响应
  }
}
```

---

## Kimi 适配器

```typescript
// lib/ai/providers/kimi.ts

class KimiAdapter implements AIProviderAdapter {
  async chat(params: AICallParams): Promise<AICallResult> {
    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.KIMI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
      }),
    });
    // ...解析响应（OpenAI 兼容格式）
  }
}
```

---

## 豆包适配器

```typescript
// lib/ai/providers/doubao.ts

class DoubaoAdapter implements AIProviderAdapter {
  async chat(params: AICallParams): Promise<AICallResult> {
    const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ARK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'doubao-pro-32k',
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
      }),
    });
    // ...解析响应（OpenAI 兼容格式）
  }
}
```

---

## AIService 统一入口

```typescript
// lib/ai/ai-service.ts

class AIService {
  private getAdapter(provider: AIProvider): AIProviderAdapter {
    switch (provider) {
      case 'deepseek': return new DeepSeekAdapter();
      case 'claude':   return new ClaudeAdapter();
      case 'kimi':     return new KimiAdapter();
      case 'doubao':   return new DoubaoAdapter();
      default: throw new Error(`Unknown provider: ${provider}`);
    }
  }

  async chat(params: AICallParams): Promise<AICallResult> {
    const adapter = this.getAdapter(params.provider);
    return adapter.chat(params);
  }
}
```

---

## 扩展点

| 扩展 | 方式 |
|------|------|
| 新增 AI 模型 | 新增 Adapter 实现类 + 在 getAdapter 注册 |
| 新增生成能力 | AIService 新增方法（如 generateImage） |
| 重试机制 | 在 chat 方法外包装 retry 逻辑 |
| 日志记录 | 调用后写入 ai_generations 表 |
| 流式输出 | Adapter 新增 streamChat 方法 |
