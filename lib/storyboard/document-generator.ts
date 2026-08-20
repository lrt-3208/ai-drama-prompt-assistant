// ============================================
// Storyboard Document — 数据收集 + AI 调用
// 查询场景/镜头/角色/风格数据 → AI 生成结构化 JSON → 保存到 DB
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Storyboards from "@/lib/models/storyboards";
import { getRenderedSystemPrompt } from "@/lib/ai/node-template-loader";
import type { StoryboardDocument } from "./document-types";

/** DI 上下文 */
export interface DocumentContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/**
 * 生成 Storyboard 文档（场景级视觉规划文档）
 *
 * 不依赖 shot_image 资产：文档是文字规划，图片只是展示增强。
 *
 * @param sceneId 场景 ID
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param ctx DI 上下文
 */
export async function generateStoryboardDocument(
  sceneId: string,
  projectId: string,
  userId: string,
  ctx?: DocumentContext
): Promise<{ storyboardId: string; versionNumber: number }> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 查询该 Scene 下所有 Shot（含完整分镜信息）
  const { data: shots, error: shotsError } = await supabase
    .from("shots")
    .select("id, shot_number, description, action, emotion, environment, cinematography, dialogue")
    .eq("scene_id", sceneId)
    .order("shot_number", { ascending: true });

  if (shotsError || !shots || shots.length === 0) {
    throw new Error("当前场景没有镜头，无法生成 Storyboard 文档");
  }

  // 2. 构建 image_refs（按 shot_number 排序，asset_id 可为空——文档不依赖图片）
  const imageRefs = shots.map((s) => ({
    shot_id: s.id,
    asset_id: "", // 文档不依赖图片，asset_id 留空
    shot_number: s.shot_number,
  }));

  // 3. 查询 Storyboard 记录（分镜时应已自动创建）
  let storyboard = await Storyboards.getByScene(sceneId, { supabase });
  if (!storyboard) {
    storyboard = await Storyboards.create(sceneId, projectId, { supabase });
  }

  // 4. 查询场景信息 + 场景参考图信息
  const { data: scene } = await supabase
    .from("scenes")
    .select("scene_number, location_name, time, weather, location_id")
    .eq("id", sceneId)
    .maybeSingle();

  let locationInfo: { name: string; description: string | null; environment: string | null; fixed_prompt: string | null } | null = null;
  if (scene?.location_id) {
    const { data: loc } = await supabase
      .from("locations")
      .select("name, description, environment, fixed_prompt")
      .eq("id", scene.location_id)
      .maybeSingle();
    locationInfo = loc;
  }

  // 5. 批量查询角色信息
  const shotIds = shots.map((s) => s.id);
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

  // 6. 查询视觉风格
  const { data: project } = await supabase
    .from("projects")
    .select("style_preset_id")
    .eq("id", projectId)
    .maybeSingle();
  let stylePrompt = "";
  if (project?.style_preset_id) {
    const { data: preset } = await supabase
      .from("style_presets")
      .select("name, fixed_prompt")
      .eq("id", project.style_preset_id)
      .maybeSingle();
    if (preset?.fixed_prompt) {
      stylePrompt = preset.fixed_prompt;
    }
  }

  // 7. 构建 user prompt（包含完整分镜信息）
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

  if (characters && characters.length > 0) {
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

  // 加载节点模板（正文已迁入 node-registry: storyboard_document）
  const documentSystemPrompt = await getRenderedSystemPrompt(supabase, userId, projectId, "storyboard_document");
  const messages: ChatMessage[] = [
    { role: "system", content: documentSystemPrompt },
    { role: "user", content: userParts.join("\n") },
  ];

  // 8. 调用 AI 生成 StoryboardDocument JSON
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const result = await AIService.generateJSON<StoryboardDocument>(
    messages,
    { userId, projectId, type: GenerationType.STORYBOARD },
    { ...aiConfig },
    ctx
  );

  // 9. 保存到 storyboards.document（JSONB）+ 版本历史
  const updated = await Storyboards.updateAsset(
    storyboard.id,
    {
      status: "ready",
      document: result,
      image_refs: imageRefs,
      project_id: projectId,
      source: "ai",
      ai_model: aiConfig.model || undefined,
    },
    { supabase }
  );

  return {
    storyboardId: storyboard.id,
    versionNumber: updated.version_number,
  };
}
