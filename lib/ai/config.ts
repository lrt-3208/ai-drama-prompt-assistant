// ============================================
// AI 配置加载 — 从 user_ai_models 表读取用户默认模型
// 实时读取，不缓存；每个用户按 modality 独立配置
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIRequestConfig } from "./types";

/** 模型类型 */
export type ModelModality = "text" | "image" | "video";

/**
 * 从 user_ai_models 表读取用户默认模型配置
 * 每次调用实时查询数据库，不缓存
 *
 * @param supabase Supabase 客户端
 * @param userId 用户 ID
 * @param modality 模型类型（text/image/video），默认 text
 * @returns Partial<AIRequestConfig> — 空对象表示未配置
 */
export async function getUserDefaultAIModel(
  supabase: SupabaseClient,
  userId: string,
  modality: ModelModality = "text"
): Promise<Partial<AIRequestConfig>> {
  const { data } = await supabase
    .from("user_ai_models")
    .select(
      "provider, model, api_base, api_key, temperature, max_tokens, modality"
    )
    .eq("user_id", userId)
    .eq("modality", modality)
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return {};

  const config: Partial<AIRequestConfig> = {
    provider: data.provider || undefined,
    model: data.model || undefined,
    apiKey: data.api_key || undefined,
    apiBase: data.api_base || undefined,
    temperature: data.temperature ?? undefined,
  };
  // 只在用户实际填写了 max_tokens 时才包含该键
  // 避免 spread 覆盖 action 文件中的 per-task 默认值
  if (data.max_tokens != null && data.max_tokens > 0) {
    config.maxTokens = data.max_tokens;
  }
  return config;
}

/**
 * 检查用户是否有指定 modality 的默认模型
 * 用于创建项目时的验证
 */
export async function hasDefaultAIModel(
  supabase: SupabaseClient,
  userId: string,
  modality: ModelModality = "text"
): Promise<boolean> {
  const { count } = await supabase
    .from("user_ai_models")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("modality", modality)
    .eq("is_default", true)
    .eq("is_active", true);

  return (count ?? 0) > 0;
}
