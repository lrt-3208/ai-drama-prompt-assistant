# AI 错误处理规范

> **AI 项目一定会遇到失败：API 超时、JSON 解析失败、模型限流。**  
> 本文件定义统一的错误处理与恢复机制。  
> 关联文档：[AI Coding Agent开发规范.md](./AI%20Coding%20Agent开发规范.md) | [../database/Supabase数据库设计.md](../database/Supabase数据库设计.md)

---

## 1. 错误类型分类

| 错误类型 | 场景 | 影响 | 处理策略 |
|----------|------|------|----------|
| API 调用失败 | 网络错误 / 服务端 500 / 401 鉴权失败 | AI 无响应 | 自动重试（最多 3 次） |
| API 限流 | 429 Rate Limit | 请求被拒 | 指数退避重试 + 用户提示 |
| API 超时 | 请求超过 30s 无响应 | 阻塞用户 | 超时取消 + 重试按钮 |
| JSON 解析失败 | AI 返回非合法 JSON | 数据无法结构化 | 重新请求 + 降级为纯文本 |
| 内容审核拦截 | AI 返回内容被审核 | 生成结果为空 | 提示用户调整输入 |
| 数据不完整 | 资产缺失（无角色/无风格） | 上下文不全 | 提示用户先补全资产 |

---

## 2. 统一错误响应格式

所有 AI 相关的 API Route 返回统一错误结构：

```typescript
interface AIErrorResponse {
  success: false;
  error: {
    type: 'api_error' | 'timeout' | 'parse_error' | 'rate_limit' | 'content_filter' | 'missing_data';
    message: string;           // 用户可读的错误信息
    retryable: boolean;        // 是否可重试
    retry_count?: number;      // 已重试次数
  }
}
```

### 成功响应

```typescript
interface AISuccessResponse<T> {
  success: true;
  data: T;
}
```

---

## 3. 重试机制

### 3.1 自动重试规则

```
第 1 次失败 → 等待 1s → 自动重试
第 2 次失败 → 等待 2s → 自动重试
第 3 次失败 → 停止重试，返回错误，展示"重试"按钮给用户
```

| 参数 | 值 |
|------|-----|
| 最大重试次数 | 3 |
| 重试间隔 | 1s, 2s（指数退避） |
| 超时阈值 | 30s（单次请求） |
| 适用场景 | API 调用失败 / 超时 / JSON 解析失败 |

### 3.2 不自动重试的场景

| 场景 | 原因 |
|------|------|
| 401 鉴权失败 | 重试无意义，需用户重新登录 |
| 内容审核拦截 | 重试同样会被拦截，需用户调整输入 |
| 数据不完整 | 需用户先补全资产 |

---

## 4. 各 AI 操作的错误处理

### 4.1 generateScript（剧本生成）

```
用户点击"生成剧本"
  ↓
调用 AI → 失败？
  ├── 是 → 自动重试（最多 3 次）
  │         ├── 重试成功 → 正常返回
  │         └── 重试失败 → 返回 error，前端展示"重试"按钮
  └── 否 → JSON 解析
              ├── 失败 → 重新请求（计入重试次数）
              └── 成功 → 保存到 scripts 表
```

**日志记录**：无论成功/失败，写入 ai_generations 表。

```typescript
// 剧本生成的错误处理伪代码
async function generateScript(projectId: string) {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const result = await aiService.chat({ /* ... */ }, { timeout: 30000 });
      const parsed = JSON.parse(result);  // 可能抛 parse_error

      // 成功：写入 ai_generations + scripts
      await logAIGeneration({ type: 'script', model, status: 'success', retry_count: retryCount });
      await saveScript(projectId, parsed);
      return { success: true, data: parsed };

    } catch (error) {
      retryCount++;
      await logAIGeneration({
        type: 'script', model,
        status: error.type === 'timeout' ? 'timeout' : 'failed',
        error_message: error.message,
        retry_count: retryCount
      });

      if (retryCount >= maxRetries || !error.retryable) {
        return {
          success: false,
          error: { type: error.type, message: error.message, retryable: false, retry_count: retryCount }
        };
      }
      await sleep(retryCount * 1000);  // 指数退避
    }
  }
}
```

### 4.2 generateStoryboard（分镜生成）

同剧本生成逻辑。额外处理：

| 场景 | 处理 |
|------|------|
| AI 返回的 Shot 数量为 0 | 视为生成失败，重试 |
| Shot 缺少 character_ids | 不阻塞，保存空数组，前端提示用户手动关联 |
| AI 返回的 Location 不在资产库 | 自动创建 Location 资产 |

### 4.3 generateImagePrompt / generateVideoPrompt（Prompt 生成）

| 场景 | 处理 |
|------|------|
| Shot 未关联角色 | 返回 missing_data 错误，提示"请先关联角色" |
| 项目未设置 Visual Style | 返回 missing_data 错误，提示"请先设置视觉风格" |
| AI 返回空内容 | 视为生成失败，重试 |
| 成功 | 保存 prompts + prompt_versions + context_snapshot |

---

## 5. 前端错误展示

### 5.1 统一 Toast 提示

| 错误类型 | Toast 文案 | 操作 |
|----------|-----------|------|
| api_error | "AI 服务暂时不可用，请重试" | 显示"重试"按钮 |
| timeout | "请求超时，请重试" | 显示"重试"按钮 |
| parse_error | "AI 返回格式异常，正在重试..." | 自动重试，3 次后显示"重试"按钮 |
| rate_limit | "请求过于频繁，请稍后再试" | 禁用按钮 10s |
| content_filter | "内容被审核拦截，请调整输入" | 无重试按钮 |
| missing_data | "请先完成 XX 资产创建" | 跳转到对应页面 |

### 5.2 Loading + Error 状态流转

```
idle → loading → success  （成功）
                → error    （失败，展示重试按钮）
                → retrying  （用户点击重试 → loading）
```

### 5.3 前端错误处理组件

```typescript
// 统一错误展示组件 Props
interface AIErrorStateProps {
  error: AIErrorResponse['error'];
  onRetry: () => void;    // 重试回调
  retrying: boolean;      // 是否正在重试
}
```

---

## 6. ai_generations 日志写入规范

每次 AI 调用（无论成功/失败）都必须写入日志：

| 时机 | 写入内容 |
|------|----------|
| 调用前 | 不写（等结果回来再写） |
| 调用成功 | type + model + status='success' + retry_count |
| 调用失败 | type + model + status='failed'/'timeout' + error_message + retry_count |

```typescript
// 日志写入伪代码
async function logAIGeneration(params: {
  type: string;
  model: string;
  status: 'success' | 'failed' | 'timeout';
  error_message?: string;
  retry_count: number;
}) {
  await supabase.from('ai_generations').insert({
    user_id: userId,
    project_id: projectId,
    type: params.type,
    model: params.model,
    status: params.status,
    error_message: params.error_message || null,
    retry_count: params.retry_count,
  });
}
```

---

## 7. 用户可感知的恢复操作

| 场景 | 用户可做什么 |
|------|-------------|
| 剧本生成失败 | 点击"重试"按钮重新生成 |
| 分镜生成失败 | 点击"重试"按钮重新生成 |
| Prompt 生成失败 | 点击"重试"按钮重新生成 |
| Prompt 生成成功但不满意 | 手动编辑 Prompt + 保存为新版本 |
| 部分镜头生成失败 | 单个镜头可独立重试，不影响其他镜头 |

**设计原则**：失败不阻塞其他操作。单镜头 Prompt 生成失败不影响其他镜头的生成。
