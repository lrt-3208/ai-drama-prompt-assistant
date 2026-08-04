// ============================================
// 镜头状态查询（从 prompts 表计算派生，无冗余字段）
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export interface ShotPromptStatus {
  hasImagePrompt: boolean;
  hasVideoPrompt: boolean;
}

/**
 * 从 prompts 表计算镜头的 Prompt 状态
 * @param shotId 镜头 ID
 * @returns 是否有图片/视频 Prompt
 */
export async function getShotPromptStatus(
  shotId: string
): Promise<ShotPromptStatus> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data } = await supabase
    .from("prompts")
    .select("prompt_type")
    .eq("shot_id", shotId);

  const types = new Set((data || []).map((p: { prompt_type: string }) => p.prompt_type));
  return {
    hasImagePrompt: types.has("image"),
    hasVideoPrompt: types.has("video"),
  };
}
