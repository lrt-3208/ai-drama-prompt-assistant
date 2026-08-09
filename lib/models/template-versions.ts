// ============================================
// Model: prompt_template_versions — 模板版本链数据访问层
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

/** prompt_template_versions 行类型 */
export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version_number: number;
  system_rule: string;
  user_rule: string | null;
  variables: unknown[] | null;
  negative_prompt_rule: string | null;
  output_format: string | null;
  example: string | null;
  is_current: boolean;
  source: string;
  created_at: string;
}

/**
 * 列出模板的所有版本
 */
export async function listByTemplate(
  templateId: string,
  ctx?: ModelContext
): Promise<TemplateVersionRow[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("prompt_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("version_number", { ascending: false });

  if (error) throw new Error(`查询模板版本失败: ${error.message}`);
  return data || [];
}

/**
 * 获取模板的当前版本
 */
export async function getCurrent(
  templateId: string,
  ctx?: ModelContext
): Promise<TemplateVersionRow | null> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("prompt_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .eq("is_current", true)
    .maybeSingle();

  if (error) throw new Error(`查询当前模板版本失败: ${error.message}`);
  return data;
}

/**
 * 按版本号获取
 */
export async function getByVersion(
  templateId: string,
  versionNumber: number,
  ctx?: ModelContext
): Promise<TemplateVersionRow | null> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("prompt_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .eq("version_number", versionNumber)
    .maybeSingle();

  if (error) throw new Error(`查询模板版本失败: ${error.message}`);
  return data;
}

/**
 * 创建新版本（自动取消旧版本 is_current，通过 service_role 写入）
 */
export async function createVersion(
  params: {
    template_id: string;
    system_rule: string;
    user_rule?: string;
    variables?: unknown[];
    negative_prompt_rule?: string;
    output_format?: string;
    example?: string;
    source?: string;
  },
  ctx?: ModelContext
): Promise<TemplateVersionRow> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 获取下一个版本号
  const { data: latest } = await supabase
    .from("prompt_template_versions")
    .select("version_number")
    .eq("template_id", params.template_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNumber = (latest?.version_number || 0) + 1;

  // 2. 取消旧版本 is_current
  await supabase
    .from("prompt_template_versions")
    .update({ is_current: false })
    .eq("template_id", params.template_id)
    .eq("is_current", true);

  // 3. 插入新版本
  const { data, error } = await supabase
    .from("prompt_template_versions")
    .insert({
      template_id: params.template_id,
      version_number: versionNumber,
      system_rule: params.system_rule,
      user_rule: params.user_rule || null,
      variables: params.variables || [],
      negative_prompt_rule: params.negative_prompt_rule || null,
      output_format: params.output_format || null,
      example: params.example || null,
      is_current: true,
      source: params.source || "system",
    })
    .select("*")
    .single();

  if (error) throw new Error(`创建模板版本失败: ${error.message}`);

  // 4. 同步更新 prompt_templates 主表
  await supabase
    .from("prompt_templates")
    .update({
      system_rule: params.system_rule,
      negative_prompt_rule: params.negative_prompt_rule || null,
      template_version: versionNumber,
    })
    .eq("id", params.template_id);

  return data;
}
