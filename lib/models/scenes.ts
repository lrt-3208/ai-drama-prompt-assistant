// ============================================
// Model: scenes — 场景数据访问层
// 成片回传 + video_snapshot 失效判定
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Storyboards from "@/lib/models/storyboards";

/** DI 上下文 */
export interface ModelContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 出片依赖快照：记录成片时的三层依赖版本号 */
export interface VideoSnapshot {
  /** ③ Scene Video Prompt（上游指令） */
  scene_video_prompt: { id: string; version_number: number } | null;
  /** ② Storyboard Document（视觉规划） */
  storyboard: { id: string; version_number: number } | null;
  /** ① 所有镜头 shot_image（帧画面） */
  shot_images: { shot_id: string; asset_id: string }[];
  /** 出片时的镜头总数 */
  shot_count: number;
}

/** 成片回传信息（scenes 表 video_* 字段） */
export interface VideoInfo {
  video_url: string | null;
  video_provider: string | null;
  video_duration: number | null;
  video_created_at: string | null;
  video_snapshot: VideoSnapshot | null;
}

/**
 * 构建 video_snapshot：查询当前三层依赖的版本号
 * - Scene Video Prompt（最新 is_current 版本的 version_number）
 * - Storyboard Document（version_number）
 * - 所有 shot_image 的 asset_id
 */
export async function buildVideoSnapshot(
  sceneId: string,
  projectId: string,
  ctx?: ModelContext
): Promise<VideoSnapshot> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 查询该场景的 scene_video_prompt（最新 is_current 版本）
  const { data: svPromptRaw } = await supabase
    .from("prompts")
    .select("id, prompt_versions!inner(version_number, is_current)")
    .eq("scene_id", sceneId)
    .eq("prompt_type", "scene_video")
    .eq("prompt_versions.is_current", true)
    .maybeSingle();

  const svPrompt = svPromptRaw as unknown as {
    id: string;
    prompt_versions: Array<{ version_number: number; is_current: boolean }>;
  } | null;

  // 2. 查询 Storyboard
  const storyboard = await Storyboards.getByScene(sceneId, { supabase });

  // 3. 查询该场景所有 shot 的 id
  const { data: shots } = await supabase
    .from("shots")
    .select("id")
    .eq("scene_id", sceneId);
  const shotIds = (shots || []).map((s) => s.id);

  // 4. 查询每个 shot 的 active shot_image 资产
  const shotImages: { shot_id: string; asset_id: string }[] = [];
  if (shotIds.length > 0) {
    const { data: assets } = await supabase
      .from("assets")
      .select("id, entity_id")
      .eq("project_id", projectId)
      .eq("entity_type", "shot")
      .eq("asset_type", "shot_image")
      .eq("status", "active")
      .in("entity_id", shotIds);

    // 每个 shot 只取第一个（与 scene-context-builder 一致）
    const seen = new Set<string>();
    for (const a of (assets || []) as Array<{ id: string; entity_id: string }>) {
      if (!seen.has(a.entity_id)) {
        seen.add(a.entity_id);
        shotImages.push({ shot_id: a.entity_id, asset_id: a.id });
      }
    }
  }

  return {
    scene_video_prompt: svPrompt
      ? {
          id: svPrompt.id,
          version_number: svPrompt.prompt_versions?.[0]?.version_number ?? 1,
        }
      : null,
    storyboard: storyboard
      ? { id: storyboard.id, version_number: storyboard.version_number }
      : null,
    shot_images: shotImages,
    shot_count: shotIds.length,
  };
}

/**
 * 回传 / 更新成片链接
 * 写入 scenes 表 video_* 字段 + 自动构建 video_snapshot
 */
export async function updateVideo(
  sceneId: string,
  projectId: string,
  data: {
    video_url: string;
    video_provider: string;
    video_duration?: number | null;
  },
  ctx?: ModelContext
): Promise<VideoInfo> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 构建 video_snapshot
  const videoSnapshot = await buildVideoSnapshot(sceneId, projectId, {
    supabase,
  });

  const { data: updated, error } = await supabase
    .from("scenes")
    .update({
      video_url: data.video_url,
      video_provider: data.video_provider,
      video_duration: data.video_duration ?? null,
      video_created_at: new Date().toISOString(),
      video_snapshot: videoSnapshot as unknown as Record<string, unknown>,
    })
    .eq("id", sceneId)
    .select(
      "video_url, video_provider, video_duration, video_created_at, video_snapshot"
    )
    .single();

  if (error) throw error;

  return (updated as unknown as VideoInfo) ?? null;
}

/**
 * 删除成片回传信息
 */
export async function deleteVideo(
  sceneId: string,
  ctx?: ModelContext
): Promise<void> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  const { error } = await supabase
    .from("scenes")
    .update({
      video_url: null,
      video_provider: null,
      video_duration: null,
      video_created_at: null,
      video_snapshot: null,
    })
    .eq("id", sceneId);

  if (error) throw error;
}

/**
 * 判定成片是否失效
 * 对比 video_snapshot 与当前依赖版本，任一不匹配 → 失效
 */
export async function checkVideoStale(
  sceneId: string,
  projectId: string,
  currentSnapshot: VideoSnapshot | null,
  ctx?: ModelContext
): Promise<{ isStale: boolean; reason: string | null }> {
  if (!currentSnapshot) {
    return { isStale: false, reason: null };
  }

  const supabase = ctx?.supabase ?? await getDefaultClient();
  const current = await buildVideoSnapshot(sceneId, projectId, { supabase });

  // ① shot_image 对比
  // 1a. 镜头总数变化（分镜被重跑，增删了镜头）
  if (currentSnapshot.shot_count !== current.shot_count) {
    return {
      isStale: true,
      reason: `镜头数量变化（${currentSnapshot.shot_count} → ${current.shot_count}）`,
    };
  }

  // 1b. 已回传图片数变化（删图 / 补图）
  //     注意：不能只正向遍历 current.shot_images —— 被删掉的图不在其中，会漏判
  const snapImageCount = currentSnapshot.shot_images.length;
  const curImageCount = current.shot_images.length;
  if (snapImageCount !== curImageCount) {
    return {
      isStale: true,
      reason:
        curImageCount < snapImageCount
          ? `镜头图片已删除（${snapImageCount} → ${curImageCount} 张）`
          : `镜头图片有新增（${snapImageCount} → ${curImageCount} 张）`,
    };
  }

  // 1c. 逐个对比 asset_id（同数量下的换图）
  const snapAssetMap = new Map(
    currentSnapshot.shot_images.map((s) => [s.shot_id, s.asset_id])
  );
  for (const img of current.shot_images) {
    const snapAsset = snapAssetMap.get(img.shot_id);
    if (snapAsset !== img.asset_id) {
      return {
        isStale: true,
        reason: "镜头图片已更换",
      };
    }
  }

  // ② Storyboard version_number 对比
  if (
    currentSnapshot.storyboard?.version_number !==
    current.storyboard?.version_number
  ) {
    return {
      isStale: true,
      reason: "Storyboard 文档已重新生成",
    };
  }

  // ③ Scene Video Prompt version_number 对比
  if (
    currentSnapshot.scene_video_prompt?.version_number !==
    current.scene_video_prompt?.version_number
  ) {
    return {
      isStale: true,
      reason: "场景视频 Prompt 已重新生成",
    };
  }

  return { isStale: false, reason: null };
}
