// ============================================
// Model: storyboards — 场景视觉故事板资产数据访问层
// Scene 级组合资产，包含该场景所有 Shot 图片编排 + document（结构化视觉规划文档）
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoryboardDocument } from "@/lib/storyboard/document-types";

/** DI 上下文 */
export interface ModelContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** storyboards 行类型 */
export interface StoryboardRow {
  id: string;
  scene_id: string;
  project_id: string;
  status: string;
  storyboard_image_asset_id: string | null; // 优化后的故事板图片 asset ID
  optimized_image_prompt: string | null; // 故事板图片优化提示词（英文，程序化生成）
  document: StoryboardDocument | null; // AI 生成的结构化文档（JSONB）
  image_refs: Array<{ shot_id: string; asset_id: string; shot_number: number }> | null;
  is_stale: boolean;
  stale_reason: string | null;
  version_number: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** storyboard_versions 行类型 */
export interface StoryboardVersionRow {
  id: string;
  storyboard_id: string;
  project_id: string;
  document: StoryboardDocument; // AI 生成的结构化文档（JSONB）
  image_refs: Array<{ shot_id: string; asset_id: string; shot_number: number }> | null;
  version_number: number;
  is_current: boolean;
  source: string;
  ai_model: string | null;
  created_at: string;
}

/**
 * 按场景 ID 查询 Storyboard
 */
export async function getByScene(
  sceneId: string,
  ctx?: ModelContext
): Promise<StoryboardRow | null> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("storyboards")
    .select("*")
    .eq("scene_id", sceneId)
    .maybeSingle();

  if (error) throw new Error(`查询 Storyboard 失败: ${error.message}`);
  return data;
}

/**
 * 按项目 ID 查询所有 Storyboard
 */
export async function getByProject(
  projectId: string,
  ctx?: ModelContext
): Promise<StoryboardRow[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("storyboards")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`查询项目 Storyboard 失败: ${error.message}`);
  return data || [];
}

/**
 * 创建 Storyboard 记录（分镜完成后自动调用）
 */
export async function create(
  sceneId: string,
  projectId: string,
  ctx?: ModelContext
): Promise<StoryboardRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("storyboards")
    .insert({
      scene_id: sceneId,
      project_id: projectId,
      status: "draft",
      image_refs: [],
      is_stale: false,
      version_number: 1,
    })
    .select("*")
    .single();

  if (error) throw new Error(`创建 Storyboard 失败: ${error.message}`);
  return data;
}

/**
 * 更新 Storyboard 状态
 */
export async function updateStatus(
  storyboardId: string,
  status: string,
  ctx?: ModelContext
): Promise<StoryboardRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("storyboards")
    .update({ status })
    .eq("id", storyboardId)
    .select("*")
    .single();

  if (error) throw new Error(`更新 Storyboard 状态失败: ${error.message}`);
  return data;
}

/**
 * 更新 Storyboard 资产内容（document + image_refs + status）
 * 自动递增 version_number + 保存版本历史到 storyboard_versions
 */
export async function updateAsset(
  storyboardId: string,
  params: {
    document?: StoryboardDocument;
    image_refs?: Array<{ shot_id: string; asset_id: string; shot_number: number }>;
    status?: string;
    source?: string;
    ai_model?: string;
    project_id?: string;
  },
  ctx?: ModelContext
): Promise<StoryboardRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 查询当前 version_number + project_id
  const { data: current } = await supabase
    .from("storyboards")
    .select("version_number, project_id, document, image_refs")
    .eq("id", storyboardId)
    .single();

  const newVersionNumber = (current?.version_number || 0) + 1;
  const projectId = params.project_id || current?.project_id;

  const updateData: Record<string, unknown> = {
    version_number: newVersionNumber,
    is_stale: false,
    stale_reason: null,
  };

  if (params.document !== undefined) {
    updateData.document = params.document;
  }
  if (params.image_refs !== undefined) {
    updateData.image_refs = params.image_refs;
  }
  if (params.status !== undefined) {
    updateData.status = params.status;
  }

  const { data, error } = await supabase
    .from("storyboards")
    .update(updateData)
    .eq("id", storyboardId)
    .select("*")
    .single();

  if (error) throw new Error(`更新 Storyboard 资产失败: ${error.message}`);

  // 保存版本历史
  if (params.document !== undefined && projectId) {
    // 将旧版本的 is_current 置 false（检查结果，失败则抛出错误）
    const { error: unsetCurrentError } = await supabase
      .from("storyboard_versions")
      .update({ is_current: false })
      .eq("storyboard_id", storyboardId);
    if (unsetCurrentError) {
      console.error("[storyboards] reset is_current failed:", unsetCurrentError.message);
      throw new Error(`重置旧版本 is_current 失败: ${unsetCurrentError.message}`);
    }

    // 插入新版本
    const { error: insertVersionError } = await supabase.from("storyboard_versions").insert({
      storyboard_id: storyboardId,
      project_id: projectId,
      document: params.document,
      image_refs: params.image_refs ?? current?.image_refs,
      version_number: newVersionNumber,
      is_current: true,
      source: params.source || "ai",
      ai_model: params.ai_model || null,
    });
    if (insertVersionError) {
      throw new Error(`插入版本历史失败: ${insertVersionError.message}`);
    }
  }

  return data;
}

/**
 * 标记 Storyboard 过期
 */
export async function markStale(
  storyboardId: string,
  reason: string,
  ctx?: ModelContext
): Promise<StoryboardRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("storyboards")
    .update({
      is_stale: true,
      stale_reason: reason,
    })
    .eq("id", storyboardId)
    .select("*")
    .single();

  if (error) throw new Error(`标记 Storyboard 过期失败: ${error.message}`);
  return data;
}

/**
 * 查询 Storyboard 的版本历史
 */
export async function getVersions(
  storyboardId: string,
  ctx?: ModelContext
): Promise<StoryboardVersionRow[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("storyboard_versions")
    .select("*")
    .eq("storyboard_id", storyboardId)
    .order("version_number", { ascending: false });

  if (error) throw new Error(`查询 Storyboard 版本失败: ${error.message}`);
  return data || [];
}

/**
 * 切换 Storyboard 当前版本
 */
export async function switchVersion(
  storyboardId: string,
  versionId: string,
  ctx?: ModelContext
): Promise<StoryboardRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 查询目标版本
  const { data: version, error: vError } = await supabase
    .from("storyboard_versions")
    .select("*")
    .eq("id", versionId)
    .single();

  if (vError || !version) throw new Error("版本不存在");

  // 将所有版本 is_current 置 false（检查结果）
  const { error: unsetAllError } = await supabase
    .from("storyboard_versions")
    .update({ is_current: false })
    .eq("storyboard_id", storyboardId);
  if (unsetAllError) {
    throw new Error(`重置版本 is_current 失败: ${unsetAllError.message}`);
  }

  // 将目标版本 is_current 置 true
  const { error: setCurrentError } = await supabase
    .from("storyboard_versions")
    .update({ is_current: true })
    .eq("id", versionId);
  if (setCurrentError) {
    throw new Error(`设置目标版本 is_current 失败: ${setCurrentError.message}`);
  }

  // 更新 storyboards 主表
  const { data, error } = await supabase
    .from("storyboards")
    .update({
      document: version.document,
      image_refs: version.image_refs,
    })
    .eq("id", storyboardId)
    .select("*")
    .single();

  if (error) throw new Error(`切换 Storyboard 版本失败: ${error.message}`);
  return data;
}

/**
 * 递增 version_number（用于 document 直接编辑，同时保存版本）
 */
export async function incrementVersion(
  storyboardId: string,
  ctx?: ModelContext
): Promise<StoryboardRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 查询当前信息
  const { data: current } = await supabase
    .from("storyboards")
    .select("version_number, project_id, document, image_refs")
    .eq("id", storyboardId)
    .single();

  const newVersionNumber = (current?.version_number || 0) + 1;

  const { data, error } = await supabase
    .from("storyboards")
    .update({
      version_number: newVersionNumber,
    })
    .eq("id", storyboardId)
    .select("*")
    .single();

  if (error) throw new Error(`递增 Storyboard 版本失败: ${error.message}`);

  // 保存版本历史
  if (current?.document && current?.project_id) {
    const { error: unsetErr } = await supabase
      .from("storyboard_versions")
      .update({ is_current: false })
      .eq("storyboard_id", storyboardId);
    if (unsetErr) {
      console.error("[storyboards] incrementVersion reset is_current failed:", unsetErr.message);
      throw new Error(`重置旧版本 is_current 失败: ${unsetErr.message}`);
    }

    const { error: insertErr } = await supabase.from("storyboard_versions").insert({
      storyboard_id: storyboardId,
      project_id: current.project_id,
      document: current.document,
      image_refs: current.image_refs,
      version_number: newVersionNumber,
      is_current: true,
      source: "manual",
    });
    if (insertErr) {
      throw new Error(`插入版本历史失败: ${insertErr.message}`);
    }
  }

  return data;
}

/**
 * 更新故事板图片 asset 关联 + 优化提示词
 * 用于故事板图片生成完成后记录 asset ID 和 prompt
 */
export async function updateImageAsset(
  storyboardId: string,
  params: {
    assetId?: string;
    optimizationPrompt?: string;
  },
  ctx?: ModelContext
): Promise<StoryboardRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  const updateData: Record<string, unknown> = {};
  if (params.assetId !== undefined) {
    updateData.storyboard_image_asset_id = params.assetId;
  }
  if (params.optimizationPrompt !== undefined) {
    updateData.optimized_image_prompt = params.optimizationPrompt;
  }

  const { data, error } = await supabase
    .from("storyboards")
    .update(updateData)
    .eq("id", storyboardId)
    .select("*")
    .single();

  if (error) throw new Error(`更新故事板图片 asset 失败: ${error.message}`);
  return data;
}
