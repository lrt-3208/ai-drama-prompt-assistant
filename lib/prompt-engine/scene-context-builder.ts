// ============================================
// Prompt Engine - 场景视频上下文构建器
// 为场景级视频 Prompt 生成收集完整的上下文
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoryboardDocument } from "@/lib/storyboard/document-types";
import { getPublicUrl } from "@/lib/tos/public-url";

/** DI 上下文 */
export interface SceneContextDI {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 镜头 + 图片 Prompt 信息 */
export interface ShotWithPrompt {
  id: string;
  shot_number: number;
  description: string | null;
  action: string | null;
  emotion: string | null;
  environment: string | null;
  cinematography: string | null;
  dialogue: string | null;
  prompt_id: string | null;
  prompt_content: string | null;
  prompt_version_number: number | null;
  asset_id: string | null;
}

/** 角色信息（去重后） */
export interface SceneCharacter {
  id: string;
  stable_key: string;
  name: string;
  fixed_prompt: string;
  version_number: number | null;
}

/** 角色视觉规范 */
export interface CharacterVisualSpec {
  character_id: string;
  spec_type: string;
  spec_name: string;
  spec_prompt: string;
}

/** 场景级视频 Prompt 生成上下文 */
export interface SceneVideoContext {
  /** 角色视觉规范列表 */
  visualSpecs: CharacterVisualSpec[];
  scene: {
    id: string;
    scene_number: number;
    location_name: string | null;
    time: string | null;
    weather: string | null;
    description: string | null;
    episode_id: string;
    project_id: string;
  };
  shots: ShotWithPrompt[];
  storyboard: {
    id: string;
    document: StoryboardDocument | null;
    image_refs: Array<{ shot_id: string; asset_id: string; shot_number: number }> | null;
    version_number: number;
    status: string;
    storyboardImageUrl: string | null;
  } | null;
  characters: SceneCharacter[];
  location: {
    id: string | null;
    name: string;
    fixed_prompt: string;
    version_number: number | null;
  } | null;
  visualStyle: {
    id: string;
    name: string;
    fixed_prompt: string;
    version_number: number | null;
  } | null;
  stylePreset: {
    id: string;
    name: string;
    fixed_prompt: string;
    negative_prompt: string | null;
  } | null;
  /** 依赖快照（写入 prompts.dependency_snapshot） */
  dependencySnapshot: Record<string, unknown>;
}

/**
 * 构建场景视频 Prompt 生成上下文
 * @param sceneId 场景 ID
 */
export async function buildSceneVideoContext(
  sceneId: string,
  ctx?: SceneContextDI
): Promise<SceneVideoContext> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 查询场景信息（scenes 表无 description 列，描述信息从 locations 获取）
  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .select(
      "id, scene_number, location_name, time, weather, location_id, episode_id, episode:episodes(project_id, project:projects(visual_style_id, style_preset_id, visual_style:visual_styles!visual_style_id(id, name, fixed_prompt)))"
    )
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneError || !scene) {
    throw new Error("场景不存在");
  }

  const projectData = (scene as unknown as {
    episode?: {
      project_id: string;
      project?: {
        visual_style_id: string | null;
        style_preset_id: string | null;
        visual_style?: { id: string; name: string; fixed_prompt: string } | null;
      };
    };
  })?.episode?.project;

  const projectId = (scene as unknown as { episode?: { project_id: string } })?.episode?.project_id || "";

  // 2. 查询该场景下所有 Shot + 最新 Image Prompt
  const { data: shots } = await supabase
    .from("shots")
    .select("id, shot_number, description, action, emotion, environment, cinematography, dialogue")
    .eq("scene_id", sceneId)
    .order("shot_number", { ascending: true });

  const shotIds = (shots || []).map((s) => s.id);

  // 查询每个 shot 的最新 image prompt
  const shotPromptMap = new Map<string, { prompt_id: string; content: string; version_number: number }>();
  const shotAssetMap = new Map<string, string>();

  if (shotIds.length > 0) {
    // 查询 prompts (image type, 最新版本)
    const { data: prompts } = await supabase
      .from("prompts")
      .select(`
        id,
        shot_id,
        prompt_versions!inner(content, version_number, is_current)
      `)
      .in("shot_id", shotIds)
      .eq("prompt_type", "image")
      .eq("prompt_versions.is_current", true);

    for (const p of (prompts || []) as unknown as Array<{
      id: string;
      shot_id: string;
      prompt_versions: Array<{ content: string; version_number: number; is_current: boolean }>;
    }>) {
      const pv = p.prompt_versions?.[0];
      if (pv) {
        shotPromptMap.set(p.shot_id, {
          prompt_id: p.id,
          content: pv.content,
          version_number: pv.version_number,
        });
      }
    }

    // 查询每个 shot 的 active 图片资产
    const { data: assets } = await supabase
      .from("assets")
      .select("id, entity_id")
      .eq("project_id", projectId)
      .eq("entity_type", "shot")
      .eq("asset_type", "shot_image")
      .eq("status", "active")
      .in("entity_id", shotIds);

    for (const a of (assets || []) as Array<{ id: string; entity_id: string }>) {
      if (!shotAssetMap.has(a.entity_id)) {
        shotAssetMap.set(a.entity_id, a.id);
      }
    }
  }

  const shotsWithPrompts: ShotWithPrompt[] = (shots || []).map((s) => {
    const prompt = shotPromptMap.get(s.id);
    return {
      ...s,
      prompt_id: prompt?.prompt_id || null,
      prompt_content: prompt?.content || null,
      prompt_version_number: prompt?.version_number || null,
      asset_id: shotAssetMap.get(s.id) || null,
    };
  });

  // 3. 查询 Storyboard Document
  const { data: storyboard } = await supabase
    .from("storyboards")
    .select("id, document, image_refs, version_number, status, storyboard_image_asset_id")
    .eq("scene_id", sceneId)
    .maybeSingle();

  // 3b. 查询故事板优化图片 URL
  let storyboardImageUrl: string | null = null;
  if (storyboard?.storyboard_image_asset_id) {
    const { data: sbAsset } = await supabase
      .from("assets")
      .select("tos_key")
      .eq("id", storyboard.storyboard_image_asset_id)
      .eq("status", "active")
      .maybeSingle();
    if (sbAsset?.tos_key) {
      storyboardImageUrl = getPublicUrl(sbAsset.tos_key);
    }
  }

  // 4. 查询角色（通过 shot_characters JOIN，去重）
  const characterIds = new Set<string>();
  const characters: SceneCharacter[] = [];
  const visualSpecs: CharacterVisualSpec[] = [];

  if (shotIds.length > 0) {
    const { data: shotChars } = await supabase
      .from("shot_characters")
      .select(`
        character:characters(id, stable_key, name, fixed_prompt)
      `)
      .in("shot_id", shotIds)
      .order("sort_order", { ascending: true });

    for (const sc of (shotChars || []) as unknown as Array<{
      character: { id: string; stable_key: string; name: string; fixed_prompt: string } | null;
    }>) {
      if (sc.character && !characterIds.has(sc.character.id)) {
        characterIds.add(sc.character.id);

        // 查询角色的 asset_prompt_versions 当前版本号
        let charVersion: number | null = null;
        const { data: apv } = await supabase
          .from("asset_prompt_versions")
          .select("version_number")
          .eq("entity_type", "character")
          .eq("entity_id", sc.character.id)
          .eq("is_current", true)
          .maybeSingle();
        charVersion = apv?.version_number ?? null;

        characters.push({
          id: sc.character.id,
          stable_key: sc.character.stable_key,
          name: sc.character.name,
          fixed_prompt: sc.character.fixed_prompt,
          version_number: charVersion,
        });
      }
    }
  }

  // 4b. 查询角色视觉规范
  if (characterIds.size > 0) {
    const { data: specs } = await supabase
      .from("character_visual_specs")
      .select("character_id, spec_type, spec_name, spec_prompt")
      .in("character_id", [...characterIds])
      .order("sort_order", { ascending: true });
    if (specs) {
      visualSpecs.push(...(specs as CharacterVisualSpec[]));
    }
  }

  // 5. 查询场景关联的 location
  let location: SceneVideoContext["location"] = null;
  const locationId = (scene as unknown as { location_id?: string })?.location_id;

  if (locationId) {
    const { data: loc } = await supabase
      .from("locations")
      .select("id, name, fixed_prompt")
      .eq("id", locationId)
      .maybeSingle();

    if (loc) {
      // 查询 location 的 asset_prompt_versions 当前版本号
      let locVersion: number | null = null;
      const { data: apv } = await supabase
        .from("asset_prompt_versions")
        .select("version_number")
        .eq("entity_type", "location")
        .eq("entity_id", loc.id)
        .eq("is_current", true)
        .maybeSingle();
      locVersion = apv?.version_number ?? null;

      location = {
        id: loc.id,
        name: loc.name,
        fixed_prompt: loc.fixed_prompt,
        version_number: locVersion,
      };
    }
  }

  // 6. 查询视觉风格
  let visualStyle: SceneVideoContext["visualStyle"] = null;
  const vsData = projectData?.visual_style;
  if (vsData) {
    let vsVersion: number | null = null;
    const { data: apv } = await supabase
      .from("asset_prompt_versions")
      .select("version_number")
      .eq("entity_type", "visual_style")
      .eq("entity_id", vsData.id)
      .eq("is_current", true)
      .maybeSingle();
    vsVersion = apv?.version_number ?? null;

    visualStyle = {
      id: vsData.id,
      name: vsData.name,
      fixed_prompt: vsData.fixed_prompt,
      version_number: vsVersion,
    };
  }

  // 7. 查询当前 style_preset
  let stylePreset: SceneVideoContext["stylePreset"] = null;
  const presetId = projectData?.style_preset_id;
  if (presetId) {
    const { data: preset } = await supabase
      .from("style_presets")
      .select("id, name, fixed_prompt, negative_prompt")
      .eq("id", presetId)
      .maybeSingle();
    if (preset) {
      stylePreset = {
        id: preset.id,
        name: preset.name,
        fixed_prompt: preset.fixed_prompt,
        negative_prompt: preset.negative_prompt,
      };
    }
  }

  // 8. 构建 dependency_snapshot
  const dependencySnapshot = {
    characters: characters.map((c) => ({
      id: c.id,
      stable_key: c.stable_key,
      version_number: c.version_number,
    })),
    location: location
      ? { id: location.id, version_number: location.version_number }
      : null,
    visual_style: visualStyle
      ? { id: visualStyle.id, version_number: visualStyle.version_number }
      : null,
    shot_prompts: shotsWithPrompts
      .filter((s) => s.prompt_id)
      .map((s) => ({
        shot_id: s.id,
        prompt_id: s.prompt_id,
        version_number: s.prompt_version_number,
      })),
    shot_images: shotsWithPrompts
      .filter((s) => s.asset_id)
      .map((s) => ({ shot_id: s.id, asset_id: s.asset_id })),
    storyboard: storyboard
      ? { id: storyboard.id, version_number: storyboard.version_number }
      : null,
    style_preset: stylePreset ? { id: stylePreset.id } : null,
  };

  return {
    visualSpecs,
    scene: {
      id: scene.id,
      scene_number: scene.scene_number,
      location_name: scene.location_name,
      time: scene.time,
      weather: scene.weather,
      description: (scene as unknown as { description?: string }).description || null,
      episode_id: (scene as unknown as { episode_id?: string }).episode_id || "",
      project_id: projectId,
    },
    shots: shotsWithPrompts,
    storyboard: storyboard
      ? {
          id: storyboard.id,
          document: storyboard.document as StoryboardDocument | null,
          image_refs: storyboard.image_refs,
          version_number: storyboard.version_number,
          status: storyboard.status,
          storyboardImageUrl,
        }
      : null,
    characters,
    location,
    visualStyle,
    stylePreset,
    dependencySnapshot,
  };
}

/**
 * 格式化场景上下文为 AI user prompt 文本
 */
export function formatSceneContextAsPrompt(context: SceneVideoContext): string {
  const parts: string[] = [];

  // 场景信息
  parts.push("【场景信息】");
  parts.push(`场景编号: ${context.scene.scene_number}`);
  if (context.scene.location_name) parts.push(`地点: ${context.scene.location_name}`);
  if (context.scene.time) parts.push(`时间: ${context.scene.time}`);
  if (context.scene.weather) parts.push(`天气: ${context.scene.weather}`);
  if (context.scene.description) parts.push(`描述: ${context.scene.description}`);

  // 镜头序列 + 图片 Prompt
  parts.push("\n【镜头序列与图片 Prompt】");
  for (const sh of context.shots) {
    parts.push(`\n--- 镜头 ${sh.shot_number} ---`);
    if (sh.description) parts.push(`画面: ${sh.description}`);
    if (sh.action) parts.push(`动作: ${sh.action}`);
    if (sh.emotion) parts.push(`情绪: ${sh.emotion}`);
    if (sh.environment) parts.push(`环境: ${sh.environment}`);
    if (sh.cinematography) parts.push(`摄影: ${sh.cinematography}`);
    if (sh.dialogue) parts.push(`对白: "${sh.dialogue}"`);
    if (sh.prompt_content) {
      parts.push(`图片 Prompt: ${sh.prompt_content}`);
    }
  }

  // Storyboard Document（结构化视觉规划文档）
  if (context.storyboard?.document) {
    const doc = context.storyboard.document;
    parts.push("\n【Storyboard 视觉规划文档】");
    parts.push(`色调: ${doc.header.color_scheme}`);
    parts.push(`氛围: ${doc.header.mood_tone}`);
    parts.push(`剪辑节奏: ${doc.header.editing_rhythm}`);
    if (doc.frames.length > 0) {
      parts.push("\n镜头帧:");
      for (const f of doc.frames) {
        parts.push(`  S${f.shot_number} [${f.shot_type}] ${f.description} | 运镜:${f.camera_movement} | 光影:${f.lighting} | 情绪:${f.emotion} | 转场:${f.transition}`);
      }
    }
    if (doc.emotion_curve.length > 0) {
      parts.push("\n情绪曲线:");
      for (const e of doc.emotion_curve) {
        parts.push(`  S${e.shot_number}: ${e.emotion} (强度${e.intensity}/10)`);
      }
    }
    parts.push(`\n音频: 环境声=${doc.audio.environment_sound}, 音乐=${doc.audio.music}, 关键音效=[${doc.audio.key_sound_effects.join(", ")}]`);
    parts.push(`摄影笔记: 镜头=${doc.cinematography_notes.lens_spec}, 运镜风格=${doc.cinematography_notes.movement_style}, 转场偏好=${doc.cinematography_notes.transition_pref}`);
  }

  // 故事板优化图片
  if (context.storyboard?.storyboardImageUrl) {
    parts.push("\n【故事板优化图片】");
    parts.push(`参考图片 URL: ${context.storyboard.storyboardImageUrl}`);
    parts.push("（请参考此图片理解场景的视觉布局和镜头序列）");
  }

  // 角色fixed_prompt（去重）
  if (context.characters.length > 0) {
    parts.push("\n【角色设定（fixed_prompt 确保一致性）】");
    for (const c of context.characters) {
      parts.push(`- ${c.name}: ${c.fixed_prompt}`);
    }
  }
  
  // 角色视觉规范（增强一致性）
  if (context.visualSpecs.length > 0) {
    parts.push("\n【角色视觉规范】");
    const specsByChar = new Map<string, CharacterVisualSpec[]>();
    for (const spec of context.visualSpecs) {
      if (!specsByChar.has(spec.character_id)) specsByChar.set(spec.character_id, []);
      specsByChar.get(spec.character_id)!.push(spec);
    }
    for (const [charId, specs] of specsByChar) {
      const char = context.characters.find((c) => c.id === charId);
      if (!char) continue;
      parts.push(`- ${char.name}:`);
      for (const spec of specs) {
        parts.push(`  ${spec.spec_name}: ${spec.spec_prompt}`);
      }
    }
  }
  
  // 场景fixed_prompt
  if (context.location) {
    parts.push("\n【场景设定】");
    parts.push(`- ${context.location.name}: ${context.location.fixed_prompt}`);
  }

  // 视觉风格
  if (context.visualStyle) {
    parts.push("\n【视觉风格】");
    parts.push(`- ${context.visualStyle.name}: ${context.visualStyle.fixed_prompt}`);
  }

  // 风格预设
  if (context.stylePreset) {
    parts.push("\n【风格预设】");
    parts.push(`- ${context.stylePreset.name}: ${context.stylePreset.fixed_prompt}`);
    if (context.stylePreset.negative_prompt) {
      parts.push(`  负面提示: ${context.stylePreset.negative_prompt}`);
    }
  }

  return parts.join("\n");
}
