// ============================================
// 生成数量配置 — 从 projects.generation_config 读取
// 各生成函数调用 getGenerationConfig 获取配置后动态注入 System Prompt
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** 生成数量配置结构 */
export interface GenerationConfig {
  character_count: { min: number; max: number };
  location_count: { min: number; max: number };
  episode_count: { min: number; max: number };
  scenes_per_episode: { min: number; max: number };
  shots_per_scene: { min: number; max: number };
}

/** 默认配置（与原始硬编码值一致） */
export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  character_count: { min: 3, max: 8 },
  location_count: { min: 3, max: 8 },
  episode_count: { min: 3, max: 10 },
  scenes_per_episode: { min: 2, max: 6 },
  shots_per_scene: { min: 2, max: 6 },
};

/** DI 上下文 */
export interface ConfigDI {
  supabase?: SupabaseClient;
}

/**
 * 读取项目的生成数量配置
 * 未配置时返回默认值
 */
export async function getGenerationConfig(
  projectId: string,
  ctx?: ConfigDI
): Promise<GenerationConfig> {
  // 如果有传入的 supabase client 就用它，否则不查询（调用方应传入）
  if (!ctx?.supabase) {
    return DEFAULT_GENERATION_CONFIG;
  }

  const { data, error } = await ctx.supabase
    .from("projects")
    .select("generation_config")
    .eq("id", projectId)
    .single();

  if (error || !data?.generation_config) {
    return DEFAULT_GENERATION_CONFIG;
  }

  const raw = data.generation_config as Partial<GenerationConfig>;
  return {
    character_count: raw.character_count ?? DEFAULT_GENERATION_CONFIG.character_count,
    location_count: raw.location_count ?? DEFAULT_GENERATION_CONFIG.location_count,
    episode_count: raw.episode_count ?? DEFAULT_GENERATION_CONFIG.episode_count,
    scenes_per_episode: raw.scenes_per_episode ?? DEFAULT_GENERATION_CONFIG.scenes_per_episode,
    shots_per_scene: raw.shots_per_scene ?? DEFAULT_GENERATION_CONFIG.shots_per_scene,
  };
}
