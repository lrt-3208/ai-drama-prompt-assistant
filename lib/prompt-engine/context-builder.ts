// ============================================
// Prompt Engine - 上下文构建器
// 从数据库收集镜头相关的角色/场景/风格信息
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** DI 上下文 */
export interface PromptEngineContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 角色上下文 */
export interface CharacterContext {
  id: string;
  name: string;
  appearance: string | null;
  clothing: string | null;
  fixed_prompt: string;
  version_number: number | null;
}

/** 场景上下文 */
export interface LocationContext {
  id: string | null;
  name: string;
  description: string | null;
  environment: string | null;
  time: string | null;
  weather: string | null;
  fixed_prompt: string;
  version_number: number | null;
}

/** 视觉风格上下文 */
export interface VisualStyleContext {
  id: string;
  name: string;
  camera_style: string | null;
  color: string | null;
  lighting: string | null;
  cinematography: string | null;
  fixed_prompt: string;
  version_number: number | null;
}

/** 镜头上下文 */
export interface ShotContext {
  id: string;
  shot_number: number;
  description: string | null;
  action: string | null;
  emotion: string | null;
  environment: string | null;
  cinematography: string | null;
  dialogue: string | null;
  scene_id: string;
  scene_number: number;
  location_name: string | null;
}

/** 完整的 Prompt 生成上下文 */
export interface PromptContext {
  shot: ShotContext;
  characters: CharacterContext[];
  location: LocationContext | null;
  visualStyle: VisualStyleContext | null;
  /** 用于保存到 prompts.context_snapshot 的快照 */
  snapshot: Record<string, unknown>;
}

/**
 * 为指定镜头构建 Prompt 生成上下文
 * @param shotId 镜头 ID
 * @returns 完整上下文
 */
export async function buildPromptContext(
  shotId: string,
  ctx?: PromptEngineContext
): Promise<PromptContext> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 查询镜头 + 场景信息
  const { data: shot, error: shotError } = await supabase
    .from("shots")
    .select(
      "id, shot_number, description, action, emotion, environment, cinematography, dialogue, scene_id"
    )
    .eq("id", shotId)
    .single();

  if (shotError || !shot) {
    throw new Error("镜头不存在");
  }

  // 2. 查询场景信息（含 episode → project → visual_style 嵌套查询）
  const { data: scene } = await supabase
    .from("scenes")
    .select(
      "id, scene_number, location_name, location_id, time, weather, episode_id, episode:episodes(project_id, project:projects(visual_style_id, visual_style:visual_styles!visual_style_id(id, name, camera_style, color, lighting, cinematography, fixed_prompt)))"
    )
    .eq("id", shot.scene_id)
    .maybeSingle();

  // 3. 查询出场角色（通过 shot_characters 关联表）
  let characters: CharacterContext[] = [];
  const { data: shotChars } = await supabase
    .from("shot_characters")
    .select(
      "character:characters(id, name, appearance, clothing, fixed_prompt)"
    )
    .eq("shot_id", shotId)
    .order("sort_order", { ascending: true });

  if (shotChars) {
    const rawChars = (shotChars as unknown as { character: Omit<CharacterContext, "version_number"> }[])
      .map((sc) => sc.character)
      .filter((c): c is Omit<CharacterContext, "version_number"> => c !== null);
    // 查询每个角色的 asset_prompt_versions 当前版本号
    characters = await Promise.all(
      rawChars.map(async (c) => {
        const { data: apv } = await supabase
          .from("asset_prompt_versions")
          .select("version_number")
          .eq("entity_type", "character")
          .eq("entity_id", c.id)
          .eq("is_current", true)
          .maybeSingle();
        return { ...c, version_number: apv?.version_number ?? null };
      })
    );
  }

  // 4. 查询场景关联的 location
  let location: LocationContext | null = null;
  if (scene?.location_id) {
    const { data: loc } = await supabase
      .from("locations")
      .select("id, name, description, environment, time, weather, fixed_prompt")
      .eq("id", scene.location_id)
      .single();
    if (loc) {
      location = { ...loc, version_number: null };
      const { data: apv } = await supabase
        .from("asset_prompt_versions")
        .select("version_number")
        .eq("entity_type", "location")
        .eq("entity_id", loc.id)
        .eq("is_current", true)
        .maybeSingle();
      location.version_number = apv?.version_number ?? null;
    }
  }

  // 如果没有关联 location_id，尝试用 location_name 查找
  if (!location && scene?.location_name) {
    const { data: loc } = await supabase
      .from("locations")
      .select("id, name, description, environment, time, weather, fixed_prompt")
      .eq("name", scene.location_name)
      .limit(1);
    if (loc && loc.length > 0) {
      location = { ...loc[0], version_number: null };
      const { data: apv } = await supabase
        .from("asset_prompt_versions")
        .select("version_number")
        .eq("entity_type", "location")
        .eq("entity_id", loc[0].id)
        .eq("is_current", true)
        .maybeSingle();
      location.version_number = apv?.version_number ?? null;
    }
  }

  // 如果仍然没有 location，创建一个基于场景信息的占位
  if (!location) {
    location = {
      id: null,
      name: scene?.location_name || "未知场景",
      description: null,
      environment: null,
      time: scene?.time || null,
      weather: scene?.weather || null,
      fixed_prompt: scene?.location_name || "未知场景",
      version_number: null,
    };
  }

  // 5. 提取项目级视觉风格（从场景嵌套查询结果中）
  let visualStyle: VisualStyleContext | null = null;
  const nestedVs = (scene as unknown as { episode?: { project?: { visual_style?: Omit<VisualStyleContext, "version_number"> } } })?.episode?.project?.visual_style;
  if (nestedVs) {
    visualStyle = { ...nestedVs, version_number: null };
    const { data: apv } = await supabase
      .from("asset_prompt_versions")
      .select("version_number")
      .eq("entity_type", "visual_style")
      .eq("entity_id", nestedVs.id)
      .eq("is_current", true)
      .maybeSingle();
    visualStyle.version_number = apv?.version_number ?? null;
  }

  // 6. 构建上下文快照（保存到 prompts.context_snapshot）
  const snapshot = {
    shot: {
      id: shot.id,
      shot_number: shot.shot_number,
      description: shot.description,
    },
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      fixed_prompt: c.fixed_prompt,
      version_number: c.version_number,
    })),
    location: location
      ? {
          id: location.id,
          name: location.name,
          fixed_prompt: location.fixed_prompt,
          version_number: location.version_number,
        }
      : null,
    visual_style: visualStyle
      ? {
          id: visualStyle.id,
          name: visualStyle.name,
          fixed_prompt: visualStyle.fixed_prompt,
          version_number: visualStyle.version_number,
        }
      : null,
    generated_at: new Date().toISOString(),
  };

  return {
    shot: {
      ...shot,
      scene_id: scene?.id || shot.scene_id,
      scene_number: scene?.scene_number || 0,
      location_name: scene?.location_name || null,
    } as ShotContext,
    characters,
    location,
    visualStyle,
    snapshot,
  };
}

/**
 * 批量预加载多个镜头的上下文
 * @param shotIds 镜头 ID 数组
 * @returns Map<shotId, PromptContext>
 */
export async function buildBatchContext(
  shotIds: string[],
  ctx?: PromptEngineContext
): Promise<Map<string, PromptContext>> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const contextMap = new Map<string, PromptContext>();

  for (const shotId of shotIds) {
    try {
      const context = await buildPromptContext(shotId, { supabase });
      contextMap.set(shotId, context);
    } catch {
      // 跳过不存在的镜头
    }
  }

  return contextMap;
}

/**
 * 将上下文格式化为 AI user prompt 文本
 * @param context Prompt 上下文
 * @param outputLanguage 输出语言（zh/en/mixed），控制格式化风格
 * @returns 格式化的 user prompt
 */
export function formatContextAsPrompt(
  context: PromptContext,
  outputLanguage: "zh" | "en" | "mixed" = "zh"
): string {
  const parts: string[] = [];

  // 镜头信息（注意：以下为剧本参考，包含可能的镜头运动描述，
  // 但图片 Prompt 只需描述一个定格画面，不要复制运动描述）
  parts.push("【镜头信息（参考，非直接输出）】");
  parts.push(`镜头编号: ${context.shot.shot_number}`);
  if (context.shot.description) parts.push(`画面描述: ${context.shot.description}`);
  if (context.shot.action) parts.push(`角色动作: ${context.shot.action}`);
  if (context.shot.emotion) parts.push(`情绪: ${context.shot.emotion}`);
  if (context.shot.environment) parts.push(`环境: ${context.shot.environment}`);
  if (context.shot.cinematography) parts.push(`摄影手法（参考）: ${context.shot.cinematography}`);
  if (context.shot.dialogue) parts.push(`对白: "${context.shot.dialogue}"`);

  // 角色信息
  if (context.characters.length > 0) {
    parts.push("\n【角色信息（使用 fixed_prompt 确保一致性）】");
    for (const c of context.characters) {
      parts.push(`- ${c.name}: ${c.fixed_prompt}`);
      if (c.appearance) parts.push(`  外貌: ${c.appearance}`);
      if (c.clothing) parts.push(`  服装: ${c.clothing}`);
    }
  }

  // 场景信息
  if (context.location) {
    parts.push("\n【场景信息（使用 fixed_prompt 确保一致性）】");
    parts.push(`- ${context.location.name}: ${context.location.fixed_prompt}`);
    if (context.location.environment) parts.push(`  环境: ${context.location.environment}`);
    if (context.location.time) parts.push(`  时间: ${context.location.time}`);
    if (context.location.weather) parts.push(`  天气: ${context.location.weather}`);
  }

  // 视觉风格
  if (context.visualStyle) {
    parts.push("\n【视觉风格（使用 fixed_prompt 确保一致性）】");
    parts.push(`- ${context.visualStyle.name}: ${context.visualStyle.fixed_prompt}`);
    if (context.visualStyle.camera_style) parts.push(`  摄影风格: ${context.visualStyle.camera_style}`);
    if (context.visualStyle.color) parts.push(`  色彩: ${context.visualStyle.color}`);
    if (context.visualStyle.lighting) parts.push(`  光影: ${context.visualStyle.lighting}`);
    if (context.visualStyle.cinematography) parts.push(`  镜头语言（参考，需转为静态构图）: ${context.visualStyle.cinematography}`);
  }

  // 语言提示
  if (outputLanguage === "en") {
    parts.push("\n请使用英文输出。");
  } else if (outputLanguage === "mixed") {
    parts.push("\n描述使用中文，摄影/技术术语可使用英文。");
  } else {
    parts.push("\n请使用中文输出。");
  }

  return parts.join("\n");
}
