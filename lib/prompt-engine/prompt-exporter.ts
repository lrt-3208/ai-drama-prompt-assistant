// ============================================
// Prompt Engine - Prompt 导出器
// 导出全套 Prompt（含场景视频 Prompt）为 JSON / Markdown / Text
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export type ExportFormat = "json" | "markdown" | "text";

interface PromptExportItem {
  prompt_type: string;
  platform: string | null;
  language: string | null;
  content: string;
  negative_prompt: string | null;
  version_number: number;
  quality_score: number | null;
  // 关联信息
  episode_number: number | null;
  scene_number: number | null;
  shot_number: number | null;
  scene_location: string | null;
  shot_description: string | null;
}

/**
 * 导出项目全套 Prompt
 * @param projectId 项目 ID
 * @param format 导出格式 (json/markdown/text)
 */
export async function exportPrompts(
  projectId: string,
  format: ExportFormat = "markdown",
  ctx?: { supabase?: SupabaseClient }
): Promise<string> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 查询所有 Prompt（含当前版本 + 关联信息）
  const { data: prompts, error } = await supabase
    .from("prompts")
    .select(`
      id,
      prompt_type,
      platform,
      language,
      negative_prompt,
      quality_score,
      shot_id,
      scene_id,
      episode_id,
      prompt_versions!inner(content, version_number, is_current, negative_prompt),
      shot:shots(shot_number, description, scene:scenes(scene_number, location_name, episode:episodes(episode_number)))
    `)
    .eq("project_id", projectId)
    .eq("prompt_versions.is_current", true)
    .order("prompt_type");

  if (error || !prompts) {
    throw new Error(`导出 Prompt 失败: ${error?.message || "未知错误"}`);
  }

  // 2. 转换为统一格式
  const items: PromptExportItem[] = [];
  for (const p of prompts as unknown as Array<{
    id: string;
    prompt_type: string;
    platform: string | null;
    language: string | null;
    negative_prompt: string | null;
    quality_score: number | null;
    shot_id: string | null;
    scene_id: string | null;
    episode_id: string | null;
    prompt_versions: Array<{ content: string; version_number: number; is_current: boolean; negative_prompt: string | null }>;
    shot?: { shot_number: number; description: string | null; scene?: { scene_number: number; location_name: string | null; episode?: { episode_number: number } } } | null;
  }>) {
    const pv = p.prompt_versions?.[0];
    if (!pv) continue;

    items.push({
      prompt_type: p.prompt_type,
      platform: p.platform,
      language: p.language,
      content: pv.content,
      negative_prompt: pv.negative_prompt || p.negative_prompt,
      version_number: pv.version_number,
      quality_score: p.quality_score,
      episode_number: p.shot?.scene?.episode?.episode_number ?? null,
      scene_number: p.shot?.scene?.scene_number ?? null,
      shot_number: p.shot?.shot_number ?? null,
      scene_location: p.shot?.scene?.location_name ?? null,
      shot_description: p.shot?.description ?? null,
    });
  }

  // 3. 按格式输出
  if (format === "json") {
    return JSON.stringify(items, null, 2);
  }

  if (format === "text") {
    return items.map((item) => {
      const header = `[${item.prompt_type}] EP${item.episode_number ?? "?"}-S${item.scene_number ?? "?"}${item.shot_number ? `-SH${item.shot_number}` : ""}`;
      return `${header}\n${item.content}${item.negative_prompt ? `\n--- Negative ---\n${item.negative_prompt}` : ""}`;
    }).join("\n\n---\n\n");
  }

  // markdown
  const md: string[] = [];
  md.push("# Prompt 导出\n");
  md.push(`> 共 ${items.length} 条 Prompt\n\n`);

  // 按 episode → scene → shot 分组
  const grouped = new Map<string, PromptExportItem[]>();
  for (const item of items) {
    const key = `EP${item.episode_number ?? "?"}-S${item.scene_number ?? "?"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  for (const [key, group] of grouped) {
    md.push(`## ${key}`);
    if (group[0].scene_location) {
      md.push(`*场景: ${group[0].scene_location}*\n`);
    }

    for (const item of group) {
      const typeLabel = item.prompt_type === "image" ? "🖼 图片" : item.prompt_type === "scene_video" ? "🎬 场景视频" : item.prompt_type;
      const shotLabel = item.shot_number ? `镜头 ${item.shot_number}` : "场景级";
      md.push(`### ${typeLabel} — ${shotLabel} (v${item.version_number})`);
      if (item.shot_description) {
        md.push(`> ${item.shot_description}\n`);
      }
      md.push("```\n" + item.content + "\n```");
      if (item.negative_prompt) {
        md.push("**Negative Prompt:**\n```\n" + item.negative_prompt + "\n```");
      }
      if (item.quality_score) {
        md.push(`*质量评分: ${item.quality_score}/5*`);
      }
      md.push("");
    }
  }

  return md.join("\n");
}
