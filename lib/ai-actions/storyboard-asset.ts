// ============================================
// AI Action - Storyboard 资产生成
// 场景级视觉规划文档：编排该场景所有 Shot 信息 → AI 生成结构化 JSON 文档
// 不存储 video_prompt（Scene Video Prompt 权威在 prompts 表）
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStoryboardDocument } from "@/lib/storyboard/document-generator";
import { STORYBOARD_DOCUMENT_SYSTEM_PROMPT } from "@/lib/storyboard/document-prompt";

/** DI 上下文 */
export interface AIActionContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/**
 * 生成 Storyboard 资产（场景级视觉规划文档）
 *
 * 内部委托给 generateStoryboardDocument。
 * 保留此函数签名以兼容现有调用方（generation-handlers、incremental-regen）。
 *
 * @param sceneId 场景 ID
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param ctx DI 上下文
 */
export async function generateStoryboardAsset(
  sceneId: string,
  projectId: string,
  userId: string,
  ctx?: AIActionContext
): Promise<{ storyboardId: string; versionNumber: number }> {
  return generateStoryboardDocument(sceneId, projectId, userId, ctx);
}

/**
 * 检查场景是否已准备好生成 Storyboard 文档
 * Storyboard 文档不依赖 shot_image，只需场景下有镜头即可
 *
 * @returns ready: 是否就绪, missingShots: 缺失镜头编号列表（始终为空，保留返回格式兼容）
 */
export async function getSceneReadiness(
  sceneId: string,
  _projectId: string,
  ctx?: AIActionContext
): Promise<{ ready: boolean; missingShots: number[] }> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  const { data: shots } = await supabase
    .from("shots")
    .select("id, shot_number")
    .eq("scene_id", sceneId)
    .order("shot_number", { ascending: true });

  if (!shots || shots.length === 0) {
    return { ready: false, missingShots: [] };
  }

  // Storyboard 文档不依赖 shot_image，只要有镜头就 ready
  return { ready: true, missingShots: [] };
}

// 导出 System Prompt 供 context-preview 使用
export { STORYBOARD_DOCUMENT_SYSTEM_PROMPT as STORYBOARD_ASSET_SYSTEM_PROMPT };
