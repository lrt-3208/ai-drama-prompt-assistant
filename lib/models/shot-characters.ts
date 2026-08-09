// ============================================
// Model: shot_characters — 镜头角色关联表数据访问层
// 替代 shots.character_ids JSONB
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

/** shot_characters 行类型 */
export interface ShotCharacterRow {
  id: string;
  shot_id: string;
  character_id: string;
  role_in_shot: string | null;
  sort_order: number;
}

/** 镜头角色关联（含角色基础信息） */
export interface ShotCharacterWithDetail extends ShotCharacterRow {
  character: {
    id: string;
    name: string;
    fixed_prompt: string;
  } | null;
}

/**
 * 按镜头 ID 查询角色关联
 */
export async function getByShot(
  shotId: string,
  ctx?: ModelContext
): Promise<ShotCharacterWithDetail[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("shot_characters")
    .select(
      `
      id, shot_id, character_id, role_in_shot, sort_order,
      character:characters(id, name, fixed_prompt)
    `
    )
    .eq("shot_id", shotId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`查询镜头角色失败: ${error.message}`);
  return (data || []) as unknown as ShotCharacterWithDetail[];
}

/**
 * 按角色 ID 反查关联镜头
 */
export async function getByCharacter(
  characterId: string,
  ctx?: ModelContext
): Promise<ShotCharacterRow[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("shot_characters")
    .select("id, shot_id, character_id, role_in_shot, sort_order")
    .eq("character_id", characterId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`按角色查询镜头失败: ${error.message}`);
  return data || [];
}

/**
 * 批量插入镜头角色关联
 */
export async function bulkInsert(
  rows: { shot_id: string; character_id: string; role_in_shot?: string; sort_order?: number }[],
  ctx?: ModelContext
): Promise<ShotCharacterRow[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("shot_characters")
    .insert(rows)
    .select("id, shot_id, character_id, role_in_shot, sort_order");

  if (error) throw new Error(`批量插入镜头角色失败: ${error.message}`);
  return data || [];
}

/**
 * 删除镜头的所有角色关联（用于重新生成分镜时清理）
 */
export async function deleteByShot(
  shotId: string,
  ctx?: ModelContext
): Promise<void> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { error } = await supabase
    .from("shot_characters")
    .delete()
    .eq("shot_id", shotId);

  if (error) throw new Error(`删除镜头角色关联失败: ${error.message}`);
}
