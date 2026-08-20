// ============================================
// 节点模板加载器 — 五级 fallback + 变量组装
//
// 生效优先级：
//   用户级(节点+模式精确) → 用户级(节点+通用) →
//   系统级(节点+模式精确) → 系统级(节点+通用) → 代码内置（node-registry 常量兜底）
//
// 返回模板原文（未渲染）+ 组装好的变量值，渲染由调用方执行
// （renderTemplate 见 lib/ai/template-renderer.ts，便于预览 API 复用）
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { getNodeDef } from "@/lib/ai/node-registry";
import { renderTemplate } from "@/lib/ai/template-renderer";
import { DEFAULT_GENERATION_CONFIG, type GenerationConfig } from "@/lib/ai-actions/config";

/** 连载模式中文说明（&serialization_mode_label 变量值；episode-plot 等处复用） */
export const SERIALIZATION_MODE_LABELS: Record<string, string> = {
  continuous: "连续剧情（集间强关联，开场承接上一集结尾，结尾埋下钩子）",
  episodic: "单元剧（本集是独立完整故事，只需共享世界观与角色，不依赖前集剧情）",
  mixed: "混合模式（有贯穿主线，但本集包含相对独立的单元故事）",
};

export interface NodeTemplateResult {
  /** 生效的模板正文（含 &变量 引用，未渲染） */
  systemRule: string;
  /** 模板来源：user=用户级 / system=系统默认 / builtin=代码内置兜底 */
  source: "user" | "system" | "builtin";
  /** 生效版本号（builtin 为 null） */
  versionNumber: number | null;
  /** 组装好的全部变量值（A 类数量 + B 类项目元信息），供 renderTemplate 使用 */
  variables: Record<string, string | number>;
}

/** llm_prompt_templates 行（查询形状） */
interface TemplateRow {
  user_id: string | null;
  serialization_mode: string | null;
  system_rule: string;
  version_number: number;
  source: string;
}

/** 项目行（查询形状） */
interface ProjectRow {
  name: string | null;
  genre: string | null;
  serialization_mode: string | null;
  generation_config: Partial<GenerationConfig> | null;
  visual_style_id: string | null;
}

/** buildNodeVariables 返回：变量值 + 项目实际连载模式（供 fallback 挑选） */
interface NodeVariablesResult {
  variables: Record<string, string | number>;
  serializationMode: string;
}

/**
 * 组装某项目的全部模板变量值（A 类数量 + B 类项目元信息）。
 * preview API 等场景可单独复用（配合 renderTemplate 渲染任意模板文本）。
 */
export async function buildNodeVariables(
  supabase: SupabaseClient,
  projectId: string,
  opts?: { episodeNumber?: number }
): Promise<NodeVariablesResult> {
  // 1. 并行查询：项目上下文 + 故事创意
  const [projRes, storyRes] = await Promise.all([
    supabase
      .from("projects")
      .select("name, genre, serialization_mode, generation_config, visual_style_id")
      .eq("id", projectId)
      .maybeSingle(),
    supabase.from("stories").select("raw_input").eq("project_id", projectId).maybeSingle(),
  ]);

  const project = (projRes.data ?? null) as ProjectRow | null;
  const story = (storyRes.data ?? null) as { raw_input: string | null } | null;

  // 2. 视觉风格（存在 visual_style_id 时查询）
  let style: { name: string | null; fixed_prompt: string | null } | null = null;
  if (project?.visual_style_id) {
    const { data } = await supabase
      .from("visual_styles")
      .select("name, fixed_prompt")
      .eq("id", project.visual_style_id)
      .maybeSingle();
    style = (data ?? null) as { name: string | null; fixed_prompt: string | null } | null;
  }

  // 3. 变量组装
  const serializationMode = project?.serialization_mode ?? "continuous";
  const genConfig: GenerationConfig = {
    character_count: project?.generation_config?.character_count ?? DEFAULT_GENERATION_CONFIG.character_count,
    location_count: project?.generation_config?.location_count ?? DEFAULT_GENERATION_CONFIG.location_count,
    episode_count: project?.generation_config?.episode_count ?? DEFAULT_GENERATION_CONFIG.episode_count,
    scenes_per_episode: project?.generation_config?.scenes_per_episode ?? DEFAULT_GENERATION_CONFIG.scenes_per_episode,
    shots_per_scene: project?.generation_config?.shots_per_scene ?? DEFAULT_GENERATION_CONFIG.shots_per_scene,
  };

  const variables: Record<string, string | number> = {
    // A 类·数量变量
    character_count_min: genConfig.character_count.min,
    character_count_max: genConfig.character_count.max,
    location_count_min: genConfig.location_count.min,
    location_count_max: genConfig.location_count.max,
    episode_count_min: genConfig.episode_count.min,
    episode_count_max: genConfig.episode_count.max,
    scenes_per_episode_min: genConfig.scenes_per_episode.min,
    scenes_per_episode_max: genConfig.scenes_per_episode.max,
    shots_per_scene_min: genConfig.shots_per_scene.min,
    shots_per_scene_max: genConfig.shots_per_scene.max,
    // B 类·项目元信息
    project_name: project?.name ?? "",
    genre: project?.genre ?? "",
    synopsis: story?.raw_input ?? "",
    serialization_mode_label: SERIALIZATION_MODE_LABELS[serializationMode] ?? SERIALIZATION_MODE_LABELS.continuous,
    style_name: style?.name ?? "",
    style_fixed_prompt: style?.fixed_prompt ?? "",
    episode_number: opts?.episodeNumber ?? "",
  };

  return { variables, serializationMode };
}

/**
 * 获取某节点当前生效的模板 + 变量值（五级 fallback）。
 *
 * @param opts.episodeNumber 当前集数（&episode_number 变量；逐集节点传入）
 */
export async function getActiveNodeTemplate(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  nodeKey: string,
  opts?: { episodeNumber?: number }
): Promise<NodeTemplateResult> {
  const def = getNodeDef(nodeKey);
  if (!def) {
    throw new Error(`未知的 LLM 节点: ${nodeKey}`);
  }

  // 1. 并行：候选模板行 + 变量组装
  const [tplRes, { variables, serializationMode }] = await Promise.all([
    supabase
      .from("llm_prompt_templates")
      .select("user_id, serialization_mode, system_rule, version_number, source")
      .eq("node_key", nodeKey)
      .eq("is_current", true)
      .or(`user_id.eq.${userId},user_id.is.null`),
    buildNodeVariables(supabase, projectId, opts),
  ]);

  const candidates = (tplRes.data ?? []) as unknown as TemplateRow[];

  // 2. 五级 fallback 挑选
  const effectiveMode = def.modeAware ? serializationMode : null;

  const pick = (userIdMatch: boolean, modeMatch: "exact" | "generic"): TemplateRow | undefined =>
    candidates.find(
      (row) =>
        (userIdMatch ? row.user_id === userId : row.user_id === null) &&
        (modeMatch === "exact"
          ? row.serialization_mode === effectiveMode && effectiveMode !== null
          : row.serialization_mode === null)
    );

  const chosen =
    pick(true, "exact") ??
    pick(true, "generic") ??
    pick(false, "exact") ??
    pick(false, "generic") ??
    undefined;

  // 3. 返回
  if (chosen) {
    return {
      systemRule: chosen.system_rule,
      source: chosen.user_id === userId ? "user" : "system",
      versionNumber: chosen.version_number,
      variables,
    };
  }

  return {
    systemRule: def.defaultSystemRule,
    source: "builtin",
    versionNumber: null,
    variables,
  };
}

/**
 * 便捷入口：加载节点模板并渲染 &变量，返回最终 system prompt 文本。
 * 未识别变量保留原文并打 warn（不影响生成）。
 */
export async function getRenderedSystemPrompt(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  nodeKey: string,
  opts?: { episodeNumber?: number }
): Promise<string> {
  const tpl = await getActiveNodeTemplate(supabase, userId, projectId, nodeKey, opts);
  const { text, unresolved } = renderTemplate(tpl.systemRule, tpl.variables);
  if (unresolved.length) {
    console.warn(`[${nodeKey}] 模板存在未识别变量，已保留原文: ${unresolved.join(", ")}`);
  }
  return text;
}
