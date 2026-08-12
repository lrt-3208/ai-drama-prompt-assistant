// ============================================
// Prompt Engine - 上下文调试预览
// 返回 AI 收到的完整文本（system + user），用于前端展示
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPromptContext, formatContextAsPrompt, type PromptEngineContext } from "./context-builder";
import { buildSceneVideoContext, formatSceneContextAsPrompt } from "./scene-context-builder";
import { SCENE_VIDEO_SYSTEM_PROMPT } from "./scene-video-prompt-generator";
import { STORYBOARD_ASSET_SYSTEM_PROMPT } from "@/lib/ai-actions/storyboard-asset";

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export interface ContextPreview {
  systemMessage: string;
  userMessage: string;
}

/**
 * 构建镜头级 AI 上下文预览
 * @param shotId 镜头 ID
 * @param platform 平台
 * @param language 语言
 */
export async function buildContextPreview(
  shotId: string,
  platform: string = "jimeng",
  language: string = "zh",
  ctx?: PromptEngineContext
): Promise<ContextPreview> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 构建上下文
  const context = await buildPromptContext(shotId, ctx);

  // 2. 获取模板
  const { data: template } = await supabase
    .from("prompt_templates")
    .select("system_rule, example, output_language, negative_prompt_rule")
    .eq("platform", platform)
    .eq("prompt_type", "image")
    .eq("language", language)
    .eq("is_active", true)
    .maybeSingle();

  const outputLanguage = (template?.output_language as "zh" | "en" | "mixed") || "zh";
  const userMessage = formatContextAsPrompt(context, outputLanguage);

  let systemMessage = template?.system_rule || "";
  if (template?.example) {
    systemMessage += `\n\n参考示例：\n${template.example}`;
  }
  if (template?.negative_prompt_rule) {
    systemMessage += `\n\n【负面提示规则】${template.negative_prompt_rule}`;
  }

  return { systemMessage, userMessage };
}

/**
 * 构建故事板 AI 上下文预览
 * 复刻 generateStoryboardDocument 的 DB 查询 + user prompt 构建
 * @param sceneId 场景 ID
 */
export async function buildStoryboardContextPreview(
  sceneId: string,
  ctx?: PromptEngineContext
): Promise<ContextPreview> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 查询该 Scene 下所有 Shot
  const { data: shots } = await supabase
    .from("shots")
    .select("id, shot_number, description, action, emotion, environment, cinematography, dialogue")
    .eq("scene_id", sceneId)
    .order("shot_number", { ascending: true });

  if (!shots || shots.length === 0) {
    return {
      systemMessage: STORYBOARD_ASSET_SYSTEM_PROMPT,
      userMessage: "当前场景没有镜头数据",
    };
  }

  const shotIds = shots.map((s) => s.id);

  // 2. 查询场景信息
  const { data: scene } = await supabase
    .from("scenes")
    .select("scene_number, location_name, time, weather, location_id")
    .eq("id", sceneId)
    .maybeSingle();

  // 3. 查询场景参考图
  let locationInfo: { name: string; description: string | null; environment: string | null; fixed_prompt: string | null } | null = null;
  if (scene?.location_id) {
    const { data: loc } = await supabase
      .from("locations")
      .select("name, description, environment, fixed_prompt")
      .eq("id", scene.location_id)
      .maybeSingle();
    locationInfo = loc;
  }

  // 4. 批量查询角色信息
  const { data: shotCharsAll } = await supabase
    .from("shot_characters")
    .select("shot_id, character_id")
    .in("shot_id", shotIds);
  const shotCharMap = new Map<string, string[]>();
  const allCharIds = new Set<string>();
  for (const sc of shotCharsAll || []) {
    const list = shotCharMap.get(sc.shot_id) || [];
    list.push(sc.character_id);
    shotCharMap.set(sc.shot_id, list);
    allCharIds.add(sc.character_id);
  }
  let characters: Array<{ id: string; name: string; visual_description: string | null; appearance_desc: string | null }> = [];
  if (allCharIds.size > 0) {
    const { data: charData } = await supabase
      .from("characters")
      .select("id, name, visual_description, appearance_desc")
      .in("id", Array.from(allCharIds));
    characters = charData || [];
  }
  const charMap = new Map(characters.map((c) => [c.id, c]));

  // 5. 查询视觉风格（scene → episode → project → style_preset）
  let stylePrompt = "";
  const { data: sceneForProject } = await supabase
    .from("scenes")
    .select("episode_id")
    .eq("id", sceneId)
    .maybeSingle();
  if (sceneForProject?.episode_id) {
    const { data: episode } = await supabase
      .from("episodes")
      .select("project_id")
      .eq("id", sceneForProject.episode_id)
      .maybeSingle();
    if (episode?.project_id) {
      const { data: project } = await supabase
        .from("projects")
        .select("style_preset_id")
        .eq("id", episode.project_id)
        .maybeSingle();
      if (project?.style_preset_id) {
        const { data: preset } = await supabase
          .from("style_presets")
          .select("name, fixed_prompt")
          .eq("id", project.style_preset_id)
          .maybeSingle();
        if (preset?.fixed_prompt) stylePrompt = preset.fixed_prompt;
      }
    }
  }

  // 6. 构建 user prompt（与 generateStoryboardDocument 保持一致）
  const userParts: string[] = [];
  userParts.push("【场景信息】");
  if (scene) {
    userParts.push(`场景编号: ${scene.scene_number}`);
    if (scene.location_name) userParts.push(`地点: ${scene.location_name}`);
    if (scene.time) userParts.push(`时间: ${scene.time}`);
    if (scene.weather) userParts.push(`天气: ${scene.weather}`);
  }

  if (locationInfo) {
    userParts.push("\n【场景参考图信息】");
    if (locationInfo.name) userParts.push(`场景名称: ${locationInfo.name}`);
    if (locationInfo.description) userParts.push(`场景描述: ${locationInfo.description}`);
    if (locationInfo.environment) userParts.push(`环境: ${locationInfo.environment}`);
    if (locationInfo.fixed_prompt) userParts.push(`场景 Prompt: ${locationInfo.fixed_prompt}`);
  }

  if (characters.length > 0) {
    userParts.push("\n【角色信息】");
    for (const c of characters) {
      const desc = c.visual_description || c.appearance_desc || "无详细描述";
      userParts.push(`- ${c.name}: ${desc}`);
    }
  }

  if (stylePrompt) {
    userParts.push(`\n【视觉风格预设】\n${stylePrompt}`);
  }

  userParts.push(`\n【镜头排列】（共 ${shots.length} 个镜头，请为每个镜头生成对应的 frame）`);
  for (const s of shots) {
    const shotCharNames = (shotCharMap.get(s.id) || [])
      .map((cid) => charMap.get(cid)?.name || "未知")
      .filter(Boolean);
    userParts.push(`\n--- 镜头 ${s.shot_number} ---`);
    if (shotCharNames.length > 0) userParts.push(`出场角色: ${shotCharNames.join(", ")}`);
    if (s.description) userParts.push(`画面描述: ${s.description}`);
    if (s.action) userParts.push(`角色动作: ${s.action}`);
    if (s.emotion) userParts.push(`情绪表达: ${s.emotion}`);
    if (s.environment) userParts.push(`环境细节: ${s.environment}`);
    if (s.cinematography) userParts.push(`摄影手法: ${s.cinematography}`);
    if (s.dialogue) userParts.push(`对白: ${s.dialogue}`);
  }

  userParts.push(`\n请基于以上完整信息，生成结构化的场景视觉规划文档。frames 数组必须包含 ${shots.length} 个镜头帧，emotion_curve 必须包含 ${shots.length} 个数据点。只输出 JSON，不要输出其他内容。`);

  return {
    systemMessage: STORYBOARD_ASSET_SYSTEM_PROMPT,
    userMessage: userParts.join("\n"),
  };
}
/**
 * 构建场景级 AI 上下文预览
 * @param sceneId 场景 ID
 * @param platform 平台
 * @param language 语言
 */
export async function buildSceneContextPreview(
  sceneId: string,
  platform: string = "jimeng",
  language: string = "zh",
  ctx?: PromptEngineContext
): Promise<ContextPreview> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 构建场景上下文
  const context = await buildSceneVideoContext(sceneId, { supabase });

  // 2. 获取模板
  const { data: template } = await supabase
    .from("prompt_templates")
    .select("system_rule, example, negative_prompt_rule")
    .eq("platform", platform)
    .eq("prompt_type", "scene_video")
    .eq("language", language)
    .eq("is_active", true)
    .maybeSingle();

  const userMessage = formatSceneContextAsPrompt(context);

  // 与 scene-video-prompt-generator 保持一致：查不到模板时使用内置默认
  let systemMessage = template?.system_rule || SCENE_VIDEO_SYSTEM_PROMPT;
  if (template?.example) {
    systemMessage += `\n\n参考示例：\n${template.example}`;
  }
  if (template?.negative_prompt_rule) {
    systemMessage += `\n\n【负面提示规则】${template.negative_prompt_rule}`;
  }

  return { systemMessage, userMessage };
}
