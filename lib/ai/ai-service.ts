// ============================================
// AI 服务层 - AIService 统一入口
// ============================================

import type {
  AIRequestConfig,
  AIResult,
  AICallContext,
  ChatMessage,
} from "./types";
import { AIError, AIErrorType, GenerationType } from "./types";
import { withRetry, toAIError } from "./error-handler";
import { logAISuccess, logAIFailure, type LoggerContext } from "./logger";
import { getProvider } from "./adapters/factory";

// 非 Prompt 类型注入中文指令（Prompt 类型由模板 output_language 控制）
const ZH_SUFFIX =
  "\n\n重要要求：所有输出内容必须使用简体中文。字段值、描述、人物名、场景名均使用中文。";

/**
 * AIService - AI 调用统一入口
 *
 * 集成 Provider 适配器 + 错误重试 + 日志记录
 */
export const AIService = {
  /**
   * 发送聊天补全请求
   * @param messages 消息列表
   * @param config 请求配置
   * @param context 调用上下文（用于日志）
   * @returns AI 调用结果
   */
  async generate(
    messages: ChatMessage[],
    config: AIRequestConfig,
    context: AICallContext,
    client?: LoggerContext
  ): Promise<AIResult> {
    const provider = getProvider(config.provider);
    const model = config.model || "qwen3.7-max";

    // 非 Prompt 类型注入中文（script/storyboard/character）
    // Prompt 类型不注入 — 语言由 prompt_templates.output_language 控制
    let processedMessages = messages;
    if (
      context.type !== GenerationType.IMAGE_PROMPT &&
      context.type !== GenerationType.SCENE_VIDEO_PROMPT &&
      context.type !== GenerationType.CHAT
    ) {
      processedMessages = messages.map((m) =>
        m.role === "system" ? { ...m, content: m.content + ZH_SUFFIX } : m
      );
    }

    let retryCount = 0;

    try {
      const result = await withRetry(
        async () => {
          return provider.chat(processedMessages, {
            ...config,
            model,
          });
        },
        (_error, attempt, _delay) => {
          retryCount = attempt;
          console.warn(
            `[AIService] 第 ${attempt} 次重试 (type=${context.type})`
          );
        }
      );

      // 记录成功日志
      await logAISuccess(
        { ...context, retryCount },
        result.model,
        client
      );

      return result;
    } catch (error) {
      const aiError = toAIError(error);

      // 记录失败日志
      await logAIFailure(
        { ...context, retryCount },
        model,
        aiError.message,
        aiError.type === AIErrorType.TIMEOUT ? "timeout" : "failed",
        client
      );

      throw aiError;
    }
  },

  /**
   * 发送 JSON 模式请求
   * @param messages 消息列表
   * @param context 调用上下文
   * @param config 额外配置（temperature 等）
   * @returns 解析后的 JSON 对象
   */
  async generateJSON<T = unknown>(
    messages: ChatMessage[],
    context: AICallContext,
    config?: Partial<AIRequestConfig>,
    client?: LoggerContext
  ): Promise<T> {
    const result = await this.generate(
      messages,
      {
        ...config,
        jsonMode: true,
        temperature: config?.temperature ?? 0.3, // JSON 模式默认低温度，可被 config 覆盖
      },
      context,
      client
    );

    if (!result.json) {
      throw new AIError(
        "AI 返回的内容无法解析为 JSON",
        AIErrorType.INVALID_RESPONSE,
        false
      );
    }

    return result.json as T;
  },

  /** Provider 名称 */
  get providerName(): string {
    return getProvider().name; // 默认 provider（qwen）
  },
};
