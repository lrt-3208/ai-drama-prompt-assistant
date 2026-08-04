// ============================================
// AI 服务层 - Provider 适配器接口
// ============================================

import type {
  AIRequestConfig,
  AIResult,
  ChatMessage,
  ProviderCapabilities,
} from "./types";

/**
 * Provider 适配器接口
 * 不同 AI 服务（Qwen, OpenAI, DeepSeek 等）实现此接口，
 * AIService 统一调用。
 */
export interface AIProvider {
  /** Provider 名称 */
  readonly name: string;

  /** Provider 能力 */
  readonly capabilities: ProviderCapabilities;

  /**
   * 发送聊天补全请求
   * @param messages 消息列表
   * @param config 请求配置
   * @returns AI 调用结果
   */
  chat(messages: ChatMessage[], config?: AIRequestConfig): Promise<AIResult>;
}
