// ============================================
// AI 配置加载 — 从 ai_config 表读取，DB 为唯一配置源
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIRequestConfig } from "./types";

async function getDefaultClient(): Promise<SupabaseClient> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const { createClient } = await import("@/utils/supabase/server");
  return createClient(cookieStore);
}

/**
 * 从数据库读取 AI 配置（provider/model/temperature/api_base/api_key）
 * DB 为唯一配置源，所有字段直接返回给调用方
 */
export async function getAIConfig(
  supabase?: SupabaseClient
): Promise<Partial<AIRequestConfig>> {
  const client = supabase ?? (await getDefaultClient());
  const { data } = await client
    .from("ai_config")
    .select("model, temperature, max_tokens, api_base, api_key")
    .eq("id", 1)
    .maybeSingle();

  if (!data) return {};

  return {
    model: data.model || undefined,
    temperature: data.temperature ?? undefined,
    maxTokens: data.max_tokens ?? undefined,
    apiKey: data.api_key || undefined,
    apiBase: data.api_base || undefined,
  };
}
