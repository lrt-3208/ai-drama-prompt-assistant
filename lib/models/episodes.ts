// ============================================
// Model: episodes — 剧集数据访问层
// 每集独立持有「剧情大纲」与「分镜大纲」，各自带版本号
// 版本号驱动下游过期判定，并支持「上游脏」递归识别
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** DI 上下文 */
export interface ModelContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 剧情大纲结构（① 剧情层） */
export interface PlotOutline {
  /** 本集标题（AI 生成剧情大纲时产出，写入 episodes.title） */
  title?: string;
  opening?: string;
  turning_point?: string;
  conflict?: string;
  ending?: string;
  core_conflict?: string;
  emotional_tone?: string;
  characters?: string[];
  /** 一句话梗概（写入 episodes.summary，供列表单行展示） */
  summary?: string;
  migrated_from?: string;
}

/** 分镜大纲中的单个场景规划（② 分镜规划层） */
export interface ShotOutlineScene {
  scene_number: number;
  title?: string;
  location?: string;
  shot_count_estimate?: number;
  emotion?: string;
  key_shots?: string[];
}

/** 分镜大纲结构 */
export interface ShotOutline {
  scenes: ShotOutlineScene[];
}

/** episodes 行类型 */
export interface EpisodeRow {
  id: string;
  project_id: string;
  episode_number: number;
  title: string | null;
  summary: string | null;
  status: string;
  // ① 剧情层
  plot_outline: PlotOutline | null;
  plot_version: number;
  plot_updated_at: string | null;
  plot_change_summary: string | null;
  // ② 分镜规划层
  shot_outline: ShotOutline | null;
  outline_version: number;
  outline_updated_at: string | null;
  outline_change_summary: string | null;
  // ③ 分镜内容层
  storyboard_version: number;
  storyboard_updated_at: string | null;
  // 「上游脏」判定基线
  outline_based_on_plot_version: number | null;
  storyboard_based_on_outline_version: number | null;
  created_at: string;
  updated_at: string;
}

/** 生产阶段（由数据推导，不落库，避免与 status 并发控制语义冲突） */
export type EpisodeStage =
  | "skeleton"
  | "plot_ready"
  | "outline_ready"
  | "storyboard_ready";

/** 过期诊断结果 */
export interface EpisodeStaleness {
  /** 分镜大纲上游脏：剧情已改但大纲未重跑 */
  outlineUpstreamDirty: boolean;
  /** 分镜内容上游脏：分镜大纲已改但分镜内容未重跑 */
  storyboardUpstreamDirty: boolean;
  /** 当前推导出的生产阶段 */
  stage: EpisodeStage;
}

export const EPISODE_COLUMNS =
  "id, project_id, episode_number, title, summary, status, " +
  "plot_outline, plot_version, plot_updated_at, plot_change_summary, " +
  "shot_outline, outline_version, outline_updated_at, outline_change_summary, " +
  "storyboard_version, storyboard_updated_at, " +
  "outline_based_on_plot_version, storyboard_based_on_outline_version, " +
  "created_at, updated_at";

/**
 * 列出项目下所有剧集（按集号升序）
 */
export async function listByProject(
  projectId: string,
  ctx?: ModelContext
): Promise<EpisodeRow[]> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  const { data, error } = await supabase
    .from("episodes")
    .select(EPISODE_COLUMNS)
    .eq("project_id", projectId)
    .order("episode_number", { ascending: true });

  if (error) throw new Error(`查询剧集失败: ${error.message}`);
  return (data ?? []) as unknown as EpisodeRow[];
}

/**
 * 按集号查询单集
 */
export async function getByNumber(
  projectId: string,
  episodeNumber: number,
  ctx?: ModelContext
): Promise<EpisodeRow | null> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  const { data, error } = await supabase
    .from("episodes")
    .select(EPISODE_COLUMNS)
    .eq("project_id", projectId)
    .eq("episode_number", episodeNumber)
    .maybeSingle();

  if (error) throw new Error(`查询第 ${episodeNumber} 集失败: ${error.message}`);
  return (data as unknown as EpisodeRow) ?? null;
}

/**
 * 确保骨架行存在（初始化时批量建集，不含任何剧情内容）
 * 已存在的集不会被覆盖
 */
export async function ensureSkeletons(
  projectId: string,
  episodeCount: number,
  ctx?: ModelContext
): Promise<number> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  const rows = Array.from({ length: episodeCount }, (_, i) => ({
    project_id: projectId,
    episode_number: i + 1,
    status: "draft",
  }));

  const { data, error } = await supabase
    .from("episodes")
    .upsert(rows, {
      onConflict: "project_id,episode_number",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) throw new Error(`创建剧集骨架失败: ${error.message}`);
  return (data ?? []).length;
}

/**
 * 追加一集（返回新集号）
 */
export async function appendEpisode(
  projectId: string,
  title?: string,
  ctx?: ModelContext
): Promise<EpisodeRow> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  const { data: last } = await supabase
    .from("episodes")
    .select("episode_number")
    .eq("project_id", projectId)
    .order("episode_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextNumber = ((last?.episode_number as number) ?? 0) + 1;

  const { data, error } = await supabase
    .from("episodes")
    .insert({
      project_id: projectId,
      episode_number: nextNumber,
      title: title ?? null,
      status: "draft",
    })
    .select(EPISODE_COLUMNS)
    .single();

  if (error) throw new Error(`追加剧集失败: ${error.message}`);
  return data as unknown as EpisodeRow;
}

/**
 * 更新剧情大纲 —— plot_version +1
 * 剧情是最上游，变更后下游分镜大纲/分镜内容/画面指令全部需重新评估
 */
export async function updatePlot(
  episodeId: string,
  params: {
    plot_outline: PlotOutline;
    title?: string | null;
    summary?: string | null;
    change_summary?: string | null;
  },
  ctx?: ModelContext
): Promise<EpisodeRow> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  const { data: current } = await supabase
    .from("episodes")
    .select("plot_version")
    .eq("id", episodeId)
    .single();

  const nextVersion = ((current?.plot_version as number) ?? 0) + 1;

  const updateData: Record<string, unknown> = {
    plot_outline: params.plot_outline,
    plot_version: nextVersion,
    plot_updated_at: new Date().toISOString(),
    plot_change_summary: params.change_summary ?? null,
  };
  if (params.title !== undefined) {
    updateData.title = params.title;
  }
  if (params.summary !== undefined) {
    updateData.summary = params.summary;
  }

  const { data, error } = await supabase
    .from("episodes")
    .update(updateData)
    .eq("id", episodeId)
    .select(EPISODE_COLUMNS)
    .single();

  if (error) throw new Error(`更新剧情大纲失败: ${error.message}`);
  return data as unknown as EpisodeRow;
}

/**
 * 更新分镜大纲 —— outline_version +1
 * 同时记录本次生成所依据的 plot_version，作为「上游脏」判定基线
 */
export async function updateShotOutline(
  episodeId: string,
  params: {
    shot_outline: ShotOutline;
    change_summary?: string | null;
  },
  ctx?: ModelContext
): Promise<EpisodeRow> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  const { data: current } = await supabase
    .from("episodes")
    .select("outline_version, plot_version")
    .eq("id", episodeId)
    .single();

  const nextVersion = ((current?.outline_version as number) ?? 0) + 1;

  const { data, error } = await supabase
    .from("episodes")
    .update({
      shot_outline: params.shot_outline,
      outline_version: nextVersion,
      outline_updated_at: new Date().toISOString(),
      outline_change_summary: params.change_summary ?? null,
      // 关键：钉住本次依据的上游版本
      outline_based_on_plot_version: (current?.plot_version as number) ?? 1,
    })
    .eq("id", episodeId)
    .select(EPISODE_COLUMNS)
    .single();

  if (error) throw new Error(`更新分镜大纲失败: ${error.message}`);
  return data as unknown as EpisodeRow;
}

/**
 * 分镜内容（scenes/shots）重新生成后调用 —— storyboard_version +1
 * 同时钉住所依据的 outline_version
 */
export async function bumpStoryboardVersion(
  episodeId: string,
  ctx?: ModelContext
): Promise<EpisodeRow> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  const { data: current } = await supabase
    .from("episodes")
    .select("storyboard_version, outline_version")
    .eq("id", episodeId)
    .single();

  const nextVersion = ((current?.storyboard_version as number) ?? 0) + 1;

  const { data, error } = await supabase
    .from("episodes")
    .update({
      storyboard_version: nextVersion,
      storyboard_updated_at: new Date().toISOString(),
      storyboard_based_on_outline_version:
        (current?.outline_version as number) ?? 1,
    })
    .eq("id", episodeId)
    .select(EPISODE_COLUMNS)
    .single();

  if (error) throw new Error(`更新分镜内容版本失败: ${error.message}`);
  return data as unknown as EpisodeRow;
}

/**
 * 诊断单集的过期状况与生产阶段
 *
 * 「上游脏」= 本层版本号没变，但它依据的上游版本已经过时。
 * 仅靠对比自身版本号无法发现，必须用 *_based_on_* 基线字段计算。
 */
export function diagnose(
  ep: Pick<
    EpisodeRow,
    | "plot_outline"
    | "plot_version"
    | "shot_outline"
    | "outline_version"
    | "outline_based_on_plot_version"
    | "storyboard_based_on_outline_version"
  >,
  hasStoryboardContent: boolean
): EpisodeStaleness {
  const hasPlot = !!ep.plot_outline;
  const hasOutline = !!ep.shot_outline;

  // 分镜大纲上游脏：有大纲，且生成时依据的 plot_version 落后于当前
  const outlineUpstreamDirty =
    hasOutline &&
    ep.outline_based_on_plot_version !== null &&
    ep.outline_based_on_plot_version < ep.plot_version;

  // 分镜内容上游脏：有分镜内容，且生成时依据的 outline_version 落后于当前
  const storyboardUpstreamDirty =
    hasStoryboardContent &&
    ep.storyboard_based_on_outline_version !== null &&
    ep.storyboard_based_on_outline_version < ep.outline_version;

  let stage: EpisodeStage = "skeleton";
  if (hasStoryboardContent) stage = "storyboard_ready";
  else if (hasOutline) stage = "outline_ready";
  else if (hasPlot) stage = "plot_ready";

  return { outlineUpstreamDirty, storyboardUpstreamDirty, stage };
}
