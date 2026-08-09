// ============================================
// Model: style_presets — 全局风格预设库数据访问层
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

/** style_presets 行类型 */
export interface StylePresetRow {
  id: string;
  name: string;
  category: string;
  fixed_prompt: string;
  negative_prompt: string | null;
  preview_url: string | null;
  is_public: boolean;
  user_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * 列出所有公开预设（按 sort_order 排序）
 */
export async function listPublic(ctx?: ModelContext): Promise<StylePresetRow[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("style_presets")
    .select("*")
    .eq("is_public", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`查询风格预设失败: ${error.message}`);
  return data || [];
}

/**
 * 列出用户私有预设
 */
export async function listByUser(
  userId: string,
  ctx?: ModelContext
): Promise<StylePresetRow[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("style_presets")
    .select("*")
    .eq("user_id", userId)
    .eq("is_public", false)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`查询用户预设失败: ${error.message}`);
  return data || [];
}

/**
 * 按 ID 查询预设
 */
export async function getById(
  id: string,
  ctx?: ModelContext
): Promise<StylePresetRow | null> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("style_presets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`查询风格预设失败: ${error.message}`);
  return data;
}

/**
 * 创建新预设
 */
export async function create(
  params: {
    name: string;
    category: string;
    fixed_prompt: string;
    negative_prompt?: string;
    preview_url?: string;
    is_public?: boolean;
    user_id: string;
  },
  ctx?: ModelContext
): Promise<StylePresetRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("style_presets")
    .insert({
      name: params.name,
      category: params.category,
      fixed_prompt: params.fixed_prompt,
      negative_prompt: params.negative_prompt || null,
      preview_url: params.preview_url || null,
      is_public: params.is_public ?? false,
      user_id: params.user_id,
    })
    .select("*")
    .single();

  if (error) throw new Error(`创建风格预设失败: ${error.message}`);
  return data;
}

/**
 * 更新预设
 */
export async function update(
  id: string,
  params: Partial<Pick<StylePresetRow, "name" | "fixed_prompt" | "negative_prompt" | "preview_url" | "is_public">>,
  ctx?: ModelContext
): Promise<StylePresetRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("style_presets")
    .update(params)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(`更新风格预设失败: ${error.message}`);
  return data;
}

/**
 * 删除预设
 */
export async function remove(
  id: string,
  ctx?: ModelContext
): Promise<void> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { error } = await supabase
    .from("style_presets")
    .delete()
    .eq("id", id);

  if (error) throw new Error(`删除风格预设失败: ${error.message}`);
}
