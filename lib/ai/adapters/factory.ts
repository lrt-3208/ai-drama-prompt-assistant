// ============================================
// AI 服务层 - Provider 工厂
// 根据 provider 名称选择适配器，默认 fallback 到 Qwen
// 未来扩展：openai / claude / gemini
// ============================================

import { QwenProvider } from "./qwen";
import type { AIProvider } from "../provider";

/** Provider 工厂映射表 */
const providers: Record<string, () => AIProvider> = {
  qwen: () => new QwenProvider(),
  // 未来扩展:
  // openai: () => new OpenAIProvider(),
  // claude: () => new ClaudeProvider(),
  // gemini: () => new GeminiProvider(),
};

/**
 * 根据 provider 名称获取适配器实例
 * 未知名称 fallback 到 Qwen（默认 Provider）
 *
 * @param name provider 标识（如 "qwen" / "openai"）
 * @returns AIProvider 实例
 */
export function getProvider(name?: string): AIProvider {
  const factory = (name && providers[name]) || providers.qwen;
  return factory();
}

/**
 * 检查是否支持指定 provider
 */
export function isProviderSupported(name: string): boolean {
  return name in providers;
}
