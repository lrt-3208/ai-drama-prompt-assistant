// ============================================
// Model: asset_prompt_versions — fixed_prompt 版本链数据访问层
// 角色/场景/风格的 fixed_prompt 版本管理
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

export type AssetEntityType = "character" | "location" | "visual_style";

/** asset_prompt_versions 行类型 */
export interface AssetPromptVersionRow {
  id: string;
  entity_type: AssetEntityType;
  entity_id: string;
  project_id: string;
  field_name: string;
  content: string;
  version_number: number;
  is_current: boolean;
  source: string;
  ai_model: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * 创建新版本（自动将旧版本 is_current 置 false）
 */
export async function createVersion(
  params: {
    entity_type: AssetEntityType;
    entity_id: string;
    project_id: string;
    field_name?: string;
    content: string;
    source?: string;
    ai_model?: string;
    metadata?: Record<string, unknown>;
  },
  ctx?: ModelContext
): Promise<AssetPromptVersionRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { entity_type, entity_id, project_id } = params;
  const field_name = params.field_name || "fixed_prompt";
  const source = params.source || "ai";

  // 1. 查询当前最大版本号
  const { data: latest } = await supabase
    .from("asset_prompt_versions")
    .select("version_number")
    .eq("entity_type", entity_type)
    .eq("entity_id", entity_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.version_number || 0) + 1;

  // 2. 将旧版本 is_current 置 false
  await supabase
    .from("asset_prompt_versions")
    .update({ is_current: false })
    .eq("entity_type", entity_type)
    .eq("entity_id", entity_id)
    .eq("is_current", true);

  // 3. 插入新版本
  const { data, error } = await supabase
    .from("asset_prompt_versions")
    .insert({
      entity_type,
      entity_id,
      project_id,
      field_name,
      content: params.content,
      version_number: nextVersion,
      is_current: true,
      source,
      ai_model: params.ai_model || null,
      metadata: params.metadata || {},
    })
    .select("*")
    .single();

  if (error) throw new Error(`创建资产版本失败: ${error.message}`);
  return data;
}

/**
 * 获取当前版本
 */
export async function getCurrent(
  entityType: AssetEntityType,
  entityId: string,
  ctx?: ModelContext
): Promise<AssetPromptVersionRow | null> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("asset_prompt_versions")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("is_current", true)
    .maybeSingle();

  if (error) throw new Error(`查询当前版本失败: ${error.message}`);
  return data;
}

/**
 * 列出所有版本
 */
export async function listVersions(
  entityType: AssetEntityType,
  entityId: string,
  ctx?: ModelContext
): Promise<AssetPromptVersionRow[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("asset_prompt_versions")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("version_number", { ascending: false });

  if (error) throw new Error(`查询版本列表失败: ${error.message}`);
  return data || [];
}

/**
 * 回退到指定版本（将指定版本设为 current，其他设为 false）
 */
export async function revertTo(
  versionId: string,
  ctx?: ModelContext
): Promise<AssetPromptVersionRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 查询目标版本
  const { data: target, error: findError } = await supabase
    .from("asset_prompt_versions")
    .select("*")
    .eq("id", versionId)
    .single();

  if (findError || !target) {
    throw new Error("目标版本不存在");
  }

  // 将同 entity 的所有版本 is_current 置 false
  await supabase
    .from("asset_prompt_versions")
    .update({ is_current: false })
    .eq("entity_type", target.entity_type)
    .eq("entity_id", target.entity_id)
    .eq("is_current", true);

  // 将目标版本设为 current
  const { data, error } = await supabase
    .from("asset_prompt_versions")
    .update({ is_current: true })
    .eq("id", versionId)
    .select("*")
    .single();

  if (error) throw new Error(`回退版本失败: ${error.message}`);
  return data;
}
