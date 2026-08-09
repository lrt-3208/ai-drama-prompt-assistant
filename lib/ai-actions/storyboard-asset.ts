// ============================================
// AI Action - Storyboard 资产生成
// 场景级组合资产：编排该场景所有 Shot 图片 + AI 生成 assistant_prompt
// 不存储 video_prompt（Scene Video Prompt 权威在 prompts 表）
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Storyboards from "@/lib/models/storyboards";

/** DI 上下文 */
export interface AIActionContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export const STORYBOARD_ASSET_SYSTEM_PROMPT = `你是一位专业的影视分镜师和 AI 视觉提示词工程师。根据场景信息、镜头排列、角色设定和视觉风格，生成一份完整的场景故事板（Storyboard）描述。

这份描述有两个用途：
1. 作为场景级视频生成模型的指导 Prompt
2. 作为 AI 绘图模型生成故事板画面（Storyboard Image）的直接提示词

因此，输出内容必须包含足够的视觉细节，让 AI 能够直接生成故事板画面。

【语言要求】描述主体使用中文，摄影/技术术语可使用英文。

【输出格式】请使用以下结构，每个部分用 === 分隔，必须包含所有部分：

=== 场景环境 ===
（100-200字）描述场景的物理空间、光线条件、天气、氛围。色调方向（冷色调/暖色调/去饱和）。关键道具和布景元素。环境音效提示。

=== 角色描述 ===
（每个角色50-100字）每个角色的外貌特征、服装细节、表情状态、在场景中的位置和移动方向。角色之间的空间关系。

=== 镜头序列 ===
（每个镜头50-100字）逐个描述每个镜头：
- 镜头编号和景别（特写/中景/远景/全景）
- 摄影机角度（俯拍/仰拍/平视）
- 画面构图重点和视觉焦点
- 角色在画面中的位置和动作
- 该镜头的情绪和氛围

=== 转场与节奏 ===
（100-200字）镜头间的转场方式（硬切/叠化/匹配剪辑/跳切等）。场景节奏变化曲线（缓慢→紧张→高潮等）。情绪基调的推进路线。音乐和音效提示。

=== 视觉风格 ===
（100-200字）光影风格（低调照明/逆光/体积光/自然光等）。色彩方案（冷色对比/去饱和偏绿/高饱和暖色等）。技术关键词（Cinematic lighting, shallow depth of field, 35mm film grain, anamorphic lens 等）。构图风格参考。

=== 故事板画面生成指令 ===
（200-400字）这是一段可以直接用于 AI 绘图模型生成故事板画面的提示词。

【最高优先级约束 — 故事板画面必须是一张静态画面】
1. 只描述一张定格的画面，不要描述镜头运动（推/拉/摇/移/环绕）
2. 不要出现时间序列语言（从...开始/随后/接着/转场至）
3. 从镜头序列中选择最具表现力的一个关键瞬间定格
4. 所有角色姿态、光影、氛围都是静态定格的

用英文编写，包含：画面整体描述、角色外观、环境氛围、构图方式、光影风格、色彩方案、技术参数。格式为逗号分隔的关键词 + 描述性句子混合。

请以 JSON 格式输出，不要输出任何其他内容：
{
  "assistant_prompt": "完整的场景故事板描述（包含上述所有部分，用 === 分隔）"
}`;

/**
 * 生成 Storyboard 资产（场景级组合资产）
 *
 * 前置条件：该 Scene 下所有 Shot 都有 active 图片资产
 *
 * @param sceneId 场景 ID
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param ctx DI 上下文
 */
export async function generateStoryboardAsset(
  sceneId: string,
  projectId: string,
  userId: string,
  ctx?: AIActionContext
): Promise<{ storyboardId: string; versionNumber: number }> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 查询该 Scene 下所有 Shot（含完整分镜信息）
  const { data: shots, error: shotsError } = await supabase
    .from("shots")
    .select("id, shot_number, description, action, emotion, environment, cinematography, dialogue")
    .eq("scene_id", sceneId)
    .order("shot_number", { ascending: true });

  if (shotsError || !shots || shots.length === 0) {
    throw new Error("当前场景没有镜头，无法生成 Storyboard");
  }

  // 2. 检查所有 Shot 是否都有 active 图片资产
  const shotIds = shots.map((s) => s.id);
  const { data: assets } = await supabase
    .from("assets")
    .select("id, entity_id")
    .eq("project_id", projectId)
    .eq("entity_type", "shot")
    .eq("asset_type", "shot_image")
    .eq("status", "active")
    .in("entity_id", shotIds);

  // 构建 shot_id → asset_id 映射
  const shotAssetMap = new Map<string, string>();
  for (const a of assets || []) {
    // 每个 shot 可能有多个 active 图片，取第一个（最新）
    if (!shotAssetMap.has(a.entity_id)) {
      shotAssetMap.set(a.entity_id, a.id);
    }
  }

  // 检查缺失
  const missingShots = shots.filter((s) => !shotAssetMap.has(s.id));
  if (missingShots.length > 0) {
    const missingList = missingShots.map((s) => `镜头 ${s.shot_number}`).join("、");
    throw new Error(`当前场景仍有镜头未生成图片（${missingList}），无法生成 Storyboard`);
  }

  // 3. 构建 image_refs（按 shot_number 排序）
  const imageRefs = shots.map((s) => ({
    shot_id: s.id,
    asset_id: shotAssetMap.get(s.id)!,
    shot_number: s.shot_number,
  }));

  // 4. 查询 Storyboard 记录（分镜时应已自动创建）
  let storyboard = await Storyboards.getByScene(sceneId, { supabase });
  if (!storyboard) {
    // 如果不存在则创建
    storyboard = await Storyboards.create(sceneId, projectId, { supabase });
  }

  // 5. 查询场景信息 + 场景参考图信息
  const { data: scene } = await supabase
    .from("scenes")
    .select("scene_number, location_name, time, weather, location_id")
    .eq("id", sceneId)
    .maybeSingle();

  // 5.1 查询场景参考图（locations 表）
  let locationInfo: { name: string; description: string | null; environment: string | null; fixed_prompt: string | null } | null = null;
  if (scene?.location_id) {
    const { data: loc } = await supabase
      .from("locations")
      .select("name, description, environment, fixed_prompt")
      .eq("id", scene.location_id)
      .maybeSingle();
    locationInfo = loc;
  }

  // 5.5 批量查询角色信息（避免 N+1 查询）
  const { data: shotCharsAll } = await supabase
    .from("shot_characters")
    .select("shot_id, character_id")
    .in("shot_id", shotIds);
  // 构建 shot_id → character_ids[] 映射
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

  // 5.6 查询视觉风格
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

  // 6. 构建 user prompt（包含完整分镜信息）
  const userParts: string[] = [];
  userParts.push("【场景信息】");
  if (scene) {
    userParts.push(`场景编号: ${scene.scene_number}`);
    if (scene.location_name) userParts.push(`地点: ${scene.location_name}`);
    if (scene.time) userParts.push(`时间: ${scene.time}`);
    if (scene.weather) userParts.push(`天气: ${scene.weather}`);
  }

  // 场景参考图信息
  if (locationInfo) {
    userParts.push("\n【场景参考图信息】");
    if (locationInfo.name) userParts.push(`场景名称: ${locationInfo.name}`);
    if (locationInfo.description) userParts.push(`场景描述: ${locationInfo.description}`);
    if (locationInfo.environment) userParts.push(`环境: ${locationInfo.environment}`);
    if (locationInfo.fixed_prompt) userParts.push(`场景 Prompt: ${locationInfo.fixed_prompt}`);
  }

  // 角色信息
  if (characters && characters.length > 0) {
    userParts.push("\n【角色信息】");
    for (const c of characters) {
      const desc = c.visual_description || c.appearance_desc || "无详细描述";
      userParts.push(`- ${c.name}: ${desc}`);
    }
  }

  // 视觉风格
  if (stylePrompt) {
    userParts.push(`\n【视觉风格预设】\n${stylePrompt}`);
  }

  // 镜头排列（含完整分镜信息 + 角色出场）
  userParts.push("\n【镜头排列】（按顺序，每个镜头附有关联图片）");
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
    userParts.push(`[已有关联图片]`);
  }

  userParts.push("\n请基于以上完整信息，生成详细的场景故事板（Storyboard）描述。必须包含所有部分：场景环境、角色描述、镜头序列（逐镜头描述）、转场与节奏、视觉风格、故事板画面生成指令。输出内容需要丰富且具体，可直接用于 AI 生成故事板画面。");

  const messages: ChatMessage[] = [
    { role: "system", content: STORYBOARD_ASSET_SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];

  // 7. 调用 AI 生成 assistant_prompt（maxTokens 由用户配置决定，留空则使用模型默认最大值）
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const result = await AIService.generateJSON<{ assistant_prompt: string }>(
    messages,
    { userId, projectId, type: GenerationType.STORYBOARD },
    { ...aiConfig },
    ctx
  );

  // 8. 更新 storyboards 表（status='ready' + assistant_prompt + image_refs + version_number 递增 + 保存版本历史）
  const updated = await Storyboards.updateAsset(
    storyboard.id,
    {
      status: "ready",
      assistant_prompt: result.assistant_prompt,
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

/**
 * 检查场景是否已准备好生成 Storyboard 资产
 * @returns ready: 是否就绪, missingShots: 缺失图片的镜头编号列表
 */
export async function getSceneReadiness(
  sceneId: string,
  projectId: string,
  ctx?: AIActionContext
): Promise<{ ready: boolean; missingShots: number[] }> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  const { data: shots } = await supabase
    .from("shots")
    .select("id, shot_number")
    .eq("scene_id", sceneId)
    .order("shot_number", { ascending: true });

  if (!shots || shots.length === 0) {
    return { ready: false, missingShots: [] };
  }

  const shotIds = shots.map((s) => s.id);
  const { data: assets } = await supabase
    .from("assets")
    .select("entity_id")
    .eq("project_id", projectId)
    .eq("entity_type", "shot")
    .eq("asset_type", "shot_image")
    .eq("status", "active")
    .in("entity_id", shotIds);

  const hasAsset = new Set((assets || []).map((a: { entity_id: string }) => a.entity_id));
  const missingShots = shots
    .filter((s) => !hasAsset.has(s.id))
    .map((s) => s.shot_number);

  return {
    ready: missingShots.length === 0,
    missingShots,
  };
}
