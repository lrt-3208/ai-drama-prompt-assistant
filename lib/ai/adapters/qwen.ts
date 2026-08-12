// ============================================
// AI 服务层 - Qwen 适配器（阿里云百炼 OpenAI 兼容模式）
// ============================================

import type {
  AIRequestConfig,
  AIResult,
  ChatMessage,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderCapabilities,
} from "../types";
import { AIError, AIErrorType } from "../types";
import type { AIProvider } from "../provider";

/** OpenAI 兼容 API 响应体 */
interface OpenAICompatibleResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** OpenAI 兼容 API 错误体 */
interface OpenAICompatibleError {
  error?: {
    message: string;
    type: string;
    code?: string;
  };
}

export class QwenProvider implements AIProvider {
  readonly name = "qwen";
  readonly capabilities: ProviderCapabilities = {
    jsonMode: true,
    streaming: false,
    maxTokens: 16384,
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor() {
    // DB 为唯一配置源，env var fallback 已移除
    this.apiKey = "";
    this.baseUrl = "";
    this.defaultModel = "qwen3.7-max";
  }

  async chat(
    messages: ChatMessage[],
    config?: AIRequestConfig
  ): Promise<AIResult> {
    const model = config?.model || this.defaultModel;
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens;
    const jsonMode = config?.jsonMode ?? false;
    const apiKey = config?.apiKey || this.apiKey;
    const baseUrl = config?.apiBase || this.baseUrl;

    if (!apiKey || !baseUrl) {
      throw new AIError(
        "AI 配置缺失：请在设置页面配置 API Key 和 API 地址",
        AIErrorType.AUTH,
        false
      );
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
    };

    // 只在明确设置了 maxTokens 时才发送，否则让 API 使用模型默认最大值
    if (maxTokens && maxTokens > 0) {
      body.max_tokens = maxTokens;
    }

    if (jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const startTime = Date.now();

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AIError(
        `网络请求失败: ${err instanceof Error ? err.message : String(err)}`,
        AIErrorType.NETWORK,
        true
      );
    }

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as OpenAICompatibleError;
      const message = errorBody?.error?.message || response.statusText;

      // 429 = 限流，可重试
      if (response.status === 429) {
        throw new AIError(
          `API 限流: ${message}`,
          AIErrorType.RATE_LIMIT,
          true,
          429
        );
      }

      // 401/403 = 认证失败，不可重试
      if (response.status === 401 || response.status === 403) {
        throw new AIError(
          `API 认证失败: ${message}`,
          AIErrorType.AUTH,
          false,
          response.status
        );
      }

      // 5xx = 服务端错误，可重试
      if (response.status >= 500) {
        throw new AIError(
          `API 服务异常 (${response.status}): ${message}`,
          AIErrorType.UNKNOWN,
          true,
          response.status
        );
      }

      throw new AIError(
        `API 错误 (${response.status}): ${message}`,
        AIErrorType.UNKNOWN,
        false,
        response.status
      );
    }

    const data = (await response.json()) as OpenAICompatibleResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new AIError(
        "API 返回空响应",
        AIErrorType.INVALID_RESPONSE,
        false
      );
    }

    const content = data.choices[0].message.content || "";

    // 如果是 JSON 模式，尝试解析
    let json: unknown = null;
    if (jsonMode) {
      try {
        json = JSON.parse(content);
      } catch {
        // 如果 JSON 解析失败，尝试从文本中提取 JSON
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            json = JSON.parse(jsonMatch[1].trim());
          } catch {
            // 提取也失败，保留原始文本
          }
        } else {
          // 尝试直接提取 { ... } 块
          const braceMatch = content.match(/\{[\s\S]*\}/);
          if (braceMatch) {
            try {
              json = JSON.parse(braceMatch[0]);
            } catch {
              // 保留原始文本
            }
          }
        }
      }
    }

    return {
      content,
      json,
      model,
      elapsed,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    };
  }

  /**
   * 图片生成（占位实现）
   *
   * 当前阶段抛出明确错误，提示用户配置图片生成模型。
   * 后续对接实际图片 API（Seedream / DALL-E 等）时，
   * 在此方法中实现具体的图生图 API 调用逻辑。
   */
  async generateImage(
    _request: ImageGenerationRequest,
    _config?: AIRequestConfig
  ): Promise<ImageGenerationResult> {
    throw new AIError(
      "图片生成功能尚未配置：请在设置页面配置图片生成模型（modality=image）",
      AIErrorType.AUTH,
      false
    );
  }
}
