// ============================================
// AI 服务层 - ImageService 图片生成统一入口
// 后续对接实际图片生成 API（Seedream / DALL-E 等）时
// 只需修改 Provider 适配器的 generateImage 方法
// ============================================

import type {
  AIRequestConfig,
  AICallContext,
  ImageGenerationRequest,
  ImageGenerationResult,
} from "./types";
import { AIError, AIErrorType, GenerationType } from "./types";
import { logAISuccess, logAIFailure, type LoggerContext } from "./logger";
import { getProvider } from "./adapters/factory";
import { getUserDefaultAIModel } from "./config";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 依赖注入上下文 */
export interface ImageServiceContext extends LoggerContext {
  supabase: SupabaseClient;
}

/**
 * ImageService - 图片生成统一入口
 *
 * 从 user_ai_models 读取用户 image modality 配置，
 * 获取 Provider 实例并调用 generateImage 方法
 */
export const ImageService = {
  /**
   * 生成图片（图生图）
   * @param request 图片生成请求（prompt + 参考图片 base64）
   * @param context 调用上下文（userId / projectId / supabase）
   * @param config 额外配置（覆盖用户默认配置）
   * @returns 图片生成结果
   */
  async generateImage(
    request: ImageGenerationRequest,
    context: AICallContext & ImageServiceContext,
    config?: Partial<AIRequestConfig>
  ): Promise<ImageGenerationResult> {
    const { supabase, userId } = context;

    // 1. 从 user_ai_models 读取用户 image modality 配置
    const userConfig = await getUserDefaultAIModel(supabase, userId, "image");

    if (!userConfig.apiKey || !userConfig.apiBase) {
      throw new AIError(
        "图片生成功能尚未配置：请在设置页面配置图片生成模型（modality=image）",
        AIErrorType.AUTH,
        false
      );
    }

    // 2. 合并配置：用户默认 < 调用方覆盖
    const mergedConfig: AIRequestConfig = {
      ...userConfig,
      ...config,
    };

    // 3. 获取 provider 实例
    const provider = getProvider(mergedConfig.provider);

    // 4. 检查 provider 是否实现 generateImage 方法
    if (!provider.generateImage) {
      throw new AIError(
        `Provider "${provider.name}" 不支持图片生成，请配置支持图片生成的 Provider`,
        AIErrorType.AUTH,
        false
      );
    }

    const model = mergedConfig.model || "unknown";
    const startTime = Date.now();

    try {
      // 5. 调用 provider.generateImage
      const result = await provider.generateImage(request, mergedConfig);

      // 6. 记录成功日志
      await logAISuccess(
        { ...context, type: GenerationType.STORYBOARD_IMAGE },
        result.model || model,
        { supabase }
      );

      return result;
    } catch (error) {
      const aiError =
        error instanceof AIError
          ? error
          : new AIError(
              error instanceof Error ? error.message : String(error),
              AIErrorType.UNKNOWN,
              false
            );

      // 记录失败日志
      await logAIFailure(
        { ...context, type: GenerationType.STORYBOARD_IMAGE },
        model,
        aiError.message,
        aiError.type === AIErrorType.TIMEOUT ? "timeout" : "failed",
        { supabase }
      );

      throw aiError;
    }
  },
};
