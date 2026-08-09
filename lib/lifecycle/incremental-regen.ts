// ============================================
// Lifecycle - 增量重生成
// 查询 is_stale=true 的 Prompt/Storyboard，重新生成
// 级联顺序：Image Prompt → Storyboard → Scene Video Prompt
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateImagePrompt } from "@/lib/prompt-engine/prompt-generator";
import { generateSceneVideoPrompt } from "@/lib/prompt-engine/scene-video-prompt-generator";
import { generateStoryboardAsset } from "@/lib/ai-actions/storyboard-asset";

/** DI 上下文 */
export interface RegenDI {
  supabase?: SupabaseClient;
}

/** 重生成结果 */
export interface RegenResult {
  regeneratedPrompts: number;
  regeneratedStoryboards: number;
  details: string[];
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/**
 * 增量重生成入口
 * 由 generation-handlers 在 task_type='run_regen' 时调用
 *
 * 流程：
 * 1. 镜头级：重新生成 stale 的 Image Prompt
 * 2. 场景级：重新生成 stale 的 Storyboard Asset
 * 3. 级联：重新生成 stale 的 Scene Video Prompt（Storyboard 重生成后版本变化，Scene Video Prompt 可能被标记 stale）
 */
export async function runIncrementalRegen(
  projectId: string,
  userId: string,
  ctx?: RegenDI
): Promise<RegenResult> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const result: RegenResult = {
    regeneratedPrompts: 0,
    regeneratedStoryboards: 0,
    details: [],
  };

  // === 1. 镜头级：重新生成 stale Image Prompt ===
  const { data: staleImagePrompts } = await supabase
    .from("prompts")
    .select("id, shot_id, platform, language")
    .eq("project_id", projectId)
    .eq("prompt_type", "image")
    .eq("is_stale", true);

  for (const p of staleImagePrompts || []) {
    try {
      await generateImagePrompt(
        p.shot_id,
        projectId,
        userId,
        p.platform || "jimeng",
        (p.language as "zh" | "en") || "zh",
        { supabase }
      );
      result.regeneratedPrompts++;
    } catch (e) {
      result.details.push(`镜头 ${p.shot_id} Image Prompt 重生成失败: ${(e as Error).message}`);
    }
  }

  if (result.regeneratedPrompts > 0) {
    result.details.push(`镜头级：${result.regeneratedPrompts} 个 Image Prompt 已重生成`);
  }

  // === 2. 场景级：重新生成 stale Storyboard Asset ===
  const { data: staleStoryboards } = await supabase
    .from("storyboards")
    .select("id, scene_id")
    .eq("project_id", projectId)
    .eq("is_stale", true);

  for (const sb of staleStoryboards || []) {
    try {
      await generateStoryboardAsset(sb.scene_id, projectId, userId, { supabase });
      result.regeneratedStoryboards++;
    } catch (e) {
      result.details.push(`Storyboard ${sb.id} 重生成失败: ${(e as Error).message}`);
    }
  }

  if (result.regeneratedStoryboards > 0) {
    result.details.push(`场景级：${result.regeneratedStoryboards} 个 Storyboard Asset 已重生成`);
  }

  // === 3. 级联：重新生成 stale Scene Video Prompt ===
  // Storyboard 重生成后 version_number 递增，可能导致 Scene Video Prompt 被标记 stale
  const { data: staleSceneVideoPrompts } = await supabase
    .from("prompts")
    .select("id, scene_id, platform, language")
    .eq("project_id", projectId)
    .eq("prompt_type", "scene_video")
    .eq("is_stale", true);

  let svRegenerated = 0;
  for (const p of staleSceneVideoPrompts || []) {
    try {
      await generateSceneVideoPrompt(
        p.scene_id,
        projectId,
        userId,
        p.platform || "jimeng",
        (p.language as "zh" | "en") || "zh",
        { supabase }
      );
      svRegenerated++;
    } catch (e) {
      result.details.push(`场景视频 Prompt ${p.scene_id} 重生成失败: ${(e as Error).message}`);
    }
  }

  if (svRegenerated > 0) {
    result.regeneratedPrompts += svRegenerated;
    result.details.push(`级联：${svRegenerated} 个 Scene Video Prompt 已重生成`);
  }

  return result;
}
