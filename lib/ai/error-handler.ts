// ============================================
// AI 服务层 - 错误处理 + 重试逻辑
// ============================================

import { AIError, AIErrorType } from "./types";

/** 重试配置 */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s
const MAX_DELAY_MS = 10000; // 10s

/**
 * 计算重试延迟（指数退避 + 随机抖动）
 */
function getRetryDelay(retryCount: number): number {
  const delay = Math.min(
    BASE_DELAY_MS * Math.pow(2, retryCount),
    MAX_DELAY_MS
  );
  // 添加 20% 随机抖动，防止雪崩
  const jitter = delay * 0.2 * Math.random();
  return Math.round(delay + jitter);
}

/**
 * 从错误中判断是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AIError) {
    return error.retryable;
  }
  // 网络错误通常可重试
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }
  return false;
}

/**
 * 带重试的异步执行器
 * @param fn 要执行的异步函数
 * @param context 重试上下文（用于日志）
 * @returns 函数执行结果
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (error: unknown, retryCount: number, delay: number) => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 最后一次尝试，不再重试
      if (attempt >= MAX_RETRIES) {
        break;
      }

      // 不可重试的错误，直接抛出
      if (!isRetryableError(error)) {
        break;
      }

      const delay = getRetryDelay(attempt);
      onRetry?.(error, attempt + 1, delay);

      // 等待后重试
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // 重试耗尽，抛出最后一个错误
  throw lastError;
}

/**
 * 包装为 AIError（如果还不是的话）
 */
export function toAIError(error: unknown): AIError {
  if (error instanceof AIError) {
    return error;
  }
  if (error instanceof Error) {
    return new AIError(
      error.message,
      AIErrorType.UNKNOWN,
      false
    );
  }
  return new AIError(
    String(error),
    AIErrorType.UNKNOWN,
    false
  );
}
