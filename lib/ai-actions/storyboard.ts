// ============================================
// AI Action - 分镜生成
// 从剧本（Script）+ 角色/场景资产，AI 生成结构化分镜
// 保存到 episodes / scenes / shots 表
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRenderedSystemPrompt } from "@/lib/ai/node-template-loader";
import * as Episodes from "@/lib/models/episodes";

/** DI 上下文（与 assets.ts 一致） */
export interface AIActionContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** AI 生成的分镜结构 */
export interface GeneratedStoryboard {
  episodes: Array<{
    episode_number: number;
    title: string;
    summary: string;
    scenes: Array<{
      scene_number: number;
      location_name: string;
      time: string;
      weather: string;
      shots: Array<{
        shot_number: number;
        description: string;
        action: string;
        emotion: string;
        environment: string;
        cinematography: string;
        dialogue: string;
        character_names: string[];
      }>;
    }>;
  }>;
}

/**
 * 生成分镜
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @returns 生成的分镜数据
 */
export async function generateStoryboard(
  projectId: string,
  userId: string,
  ctx?: AIActionContext
): Promise<GeneratedStoryboard> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 读取剧本数据
  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("*")
    .eq("project_id", projectId)
    .single();

  if (scriptError || !script) {
    throw new Error("请先生成剧本后再生成分镜");
  }

  // 2. 读取角色资产（用于名字映射）
  const { data: characters } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);

  // 3. 读取场景资产（用于名字映射）
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name")
    .eq("project_id", projectId);

  // 4. 构建 user prompt
  const userParts: string[] = [];

  userParts.push("【剧本信息】");
  userParts.push(`梗概: ${script.synopsis || ""}`);
  userParts.push(`类型: ${script.genre || ""}`);
  if (script.relationships) userParts.push(`角色关系: ${script.relationships}`);
  if (script.worldview) userParts.push(`世界观: ${script.worldview}`);

  if (script.characters) {
    userParts.push("\n【剧本角色】");
    const chars = Array.isArray(script.characters)
      ? script.characters
      : JSON.parse(script.characters as string);
    for (const c of chars) {
      userParts.push(`- ${c.name} (${c.role}): ${c.description}`);
    }
  }

  if (script.plot_outline) {
    userParts.push("\n【剧情大纲】");
    const outline = Array.isArray(script.plot_outline)
      ? script.plot_outline
      : JSON.parse(script.plot_outline as string);
    for (const p of outline) {
      userParts.push(
        `- 场景${p.scene}: ${p.description} (情绪: ${p.emotion})`
      );
    }
  }

  if (characters && characters.length > 0) {
    userParts.push("\n【可用角色名（镜头中请使用这些名字）】");
    userParts.push(characters.map((c) => c.name).join(", "));
  }

  if (locations && locations.length > 0) {
    userParts.push("\n【可用场景名】");
    userParts.push(locations.map((l) => l.name).join(", "));
  }

  userParts.push(
    "\n请基于以上剧本，生成详细的分镜列表。每个镜头要具体可执行。"
  );

  // 5. 加载节点模板（数量变量由模板渲染注入；modeAware 节点按项目连载模式选模板）
  const storyboardSystemPrompt = await getRenderedSystemPrompt(supabase, userId, projectId, "storyboard");
  const messages: ChatMessage[] = [
    { role: "system", content: storyboardSystemPrompt },
    { role: "user", content: userParts.join("\n") },
  ];

  // 5. 调用 AI 生成
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const storyboard = await AIService.generateJSON<GeneratedStoryboard>(
    messages,
    { userId, projectId, type: GenerationType.STORYBOARD },
    { ...aiConfig },
    { supabase }
  );

  // 6. 清理旧的分镜内容
  //    只删 scenes（级联清理 shots / prompts / storyboards），保留 episodes 行 ——
  //    episodes 承载剧情大纲(plot_outline)、分镜大纲(shot_outline)与各层版本号基线，
  //    删掉会连带丢失剧情数据与过期判定依据。
  const { data: oldEpisodes } = await supabase
    .from("episodes")
    .select("id")
    .eq("project_id", projectId);

  if (oldEpisodes && oldEpisodes.length > 0) {
    await supabase
      .from("scenes")
      .delete()
      .in(
        "episode_id",
        oldEpisodes.map((e) => e.id)
      );
  }

  // 7. 构建角色名 → ID 的映射
  const charMap = new Map<string, string>();
  if (characters) {
    for (const c of characters) {
      charMap.set(c.name, c.id);
    }
  }

  // 8. 构建场景名 → ID 的映射
  const locMap = new Map<string, string>();
  if (locations) {
    for (const l of locations) {
      locMap.set(l.name, l.id);
    }
  }

  // 9. 保存到数据库
  const createdSceneIds: string[] = [];
  for (const ep of storyboard.episodes) {
    // upsert episode（行可能已存在且带剧情大纲，不能 insert 覆盖）
    const { data: episode, error: epError } = await supabase
      .from("episodes")
      .upsert(
        {
          project_id: projectId,
          episode_number: ep.episode_number,
          title: ep.title,
          summary: ep.summary,
          status: "storyboarded",
        },
        { onConflict: "project_id,episode_number" }
      )
      .select("id")
      .single();

    if (epError || !episode) {
      throw new Error(`创建剧集失败: ${epError?.message}`);
    }

    // 分镜内容已重建 → 递增 storyboard_version，使该集下游画面指令判定为过期
    await Episodes.bumpStoryboardVersion(episode.id, { supabase });

    for (const sc of ep.scenes) {
      // 查找匹配的 location_id
      const locationId = locMap.get(sc.location_name) || null;

      // 插入 scene
      const { data: scene, error: scError } = await supabase
        .from("scenes")
        .insert({
          episode_id: episode.id,
          location_id: locationId,
          scene_number: sc.scene_number,
          location_name: sc.location_name,
          time: sc.time || null,
          weather: sc.weather || null,
        })
        .select("id")
        .single();

      if (scError || !scene) {
        throw new Error(`创建场景失败: ${scError?.message}`);
      }

      createdSceneIds.push(scene.id);

      for (const sh of sc.shots) {
        // 将角色名映射为 ID
        const characterIds = (sh.character_names || [])
          .map((name) => charMap.get(name))
          .filter((id): id is string => !!id);

        // 插入 shot（不再存 character_ids，改用 shot_characters 关联表）
        const { data: newShot, error: shError } = await supabase
          .from("shots")
          .insert({
            scene_id: scene.id,
            shot_number: sh.shot_number,
            description: sh.description,
            action: sh.action || null,
            emotion: sh.emotion || null,
            environment: sh.environment || null,
            cinematography: sh.cinematography || null,
            dialogue: sh.dialogue || null,
          })
          .select("id")
          .single();

        if (shError || !newShot) {
          throw new Error(`创建镜头失败: ${shError?.message}`);
        }

        // 写入 shot_characters 关联表
        if (characterIds.length > 0) {
          const scRows = characterIds.map((charId, idx) => ({
            shot_id: newShot.id,
            character_id: charId,
            sort_order: idx,
          }));
          const { error: scErr } = await supabase
            .from("shot_characters")
            .insert(scRows);
          if (scErr) {
            throw new Error(`写入镜头角色关联失败: ${scErr.message}`);
          }
        }
      }
    }
  }

  // 9.5. 为每个 Scene 创建 storyboards 记录（status='draft'）
  if (createdSceneIds.length > 0) {
    const sbRows = createdSceneIds.map((sceneId) => ({
      scene_id: sceneId,
      project_id: projectId,
      status: "draft",
      image_refs: [],
      is_stale: false,
      version_number: 1,
    }));
    const { error: sbError } = await supabase
      .from("storyboards")
      .insert(sbRows);
    if (sbError) {
      console.error(`创建 Storyboard 记录失败: ${sbError.message}`);
    }
  }

  // 10. 更新项目状态为 storyboarding
  await supabase
    .from("projects")
    .update({ status: "storyboarding" })
    .eq("id", projectId);

  return storyboard;
}

// ============================================
// 按集生成分镜
// 只传该集的 episode_outline，不传整个剧本
// ============================================

/** 单集 AI 生成结果 */
interface GeneratedEpisode {
  episode_number: number;
  title: string;
  summary: string;
  scenes: Array<{
    scene_number: number;
    location_name: string;
    time: string;
    weather: string;
    shots: Array<{
      shot_number: number;
      description: string;
      action: string;
      emotion: string;
      environment: string;
      cinematography: string;
      dialogue: string;
      character_names: string[];
    }>;
  }>;
}

/**
 * 生成单集分镜（只传该集大纲，不传整个剧本）
 * @param projectId 项目 ID
 * @param episodeNumber 集数
 * @param userId 用户 ID
 * @returns 生成的分镜数据
 */
export async function generateEpisodeStoryboard(
  projectId: string,
  episodeNumber: number,
  userId: string,
  ctx?: AIActionContext
): Promise<GeneratedEpisode> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 0. 并发检查：episode.status === 'generating' → 抛 409
  const { data: existingEp } = await supabase
    .from("episodes")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("episode_number", episodeNumber)
    .maybeSingle();

  if (existingEp?.status === "generating") {
    throw new Error("409:该集正在生成中，请稍候");
  }

  // 1. 读取整体背景（供 AI 参考世界观/角色关系）
  //    优先 stories（初始化故事创意，新架构权威数据源），兼容回退 scripts（旧链路数据）
  const [scriptRes, storyRes] = await Promise.all([
    supabase
      .from("scripts")
      .select("synopsis, genre, relationships, worldview, characters")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("stories")
      .select("raw_input, theme, genre, core_conflict, target_emotion")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);
  const script = scriptRes.data;
  const story = storyRes.data;

  // 2. 严格依赖校验：分镜内容必须基于该集分镜大纲（episodes.shot_outline）生成
  //    依赖链：剧情大纲(plot_outline) → 分镜大纲(shot_outline) → 分镜内容(scenes/shots)
  //    不再回退 scripts.episode_outline / plot_outline，避免绕过前置依赖
  if (!existingEp) {
    throw new Error(`第 ${episodeNumber} 集不存在，请先完成项目初始化`);
  }

  const epRow = await Episodes.getByNumber(projectId, episodeNumber, { supabase });
  if (!epRow?.shot_outline?.scenes?.length) {
    throw new Error(`第 ${episodeNumber} 集分镜大纲未生成，请先在剧本 Tab 生成分镜大纲`);
  }

  // 有结构化分镜大纲 → 序列化为文本大纲喂给分镜生成
  const scenesText = epRow.shot_outline.scenes
    .map((s) => {
      const bits = [`场景${s.scene_number}${s.title ? ` ${s.title}` : ""}`];
      if (s.location) bits.push(`地点:${s.location}`);
      if (s.emotion) bits.push(`情绪:${s.emotion}`);
      if (s.shot_count_estimate) bits.push(`约${s.shot_count_estimate}镜`);
      if (s.key_shots?.length) bits.push(`重点:${s.key_shots.join("、")}`);
      return bits.join(" · ");
    })
    .join("\n");
  const epOutline = {
    episode: episodeNumber,
    title: epRow.title || `第 ${episodeNumber} 集`,
    outline: scenesText,
  };

  // 3. 读取角色资产
  const { data: characters } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);

  // 4. 读取场景资产
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name")
    .eq("project_id", projectId);

  // 5. episode.status = 'generating'（乐观锁）
  //    严格依赖校验后 episode 骨架必已存在（初始化时创建），不再有 placeholder 创建分支
  const episodeId = existingEp.id;
  await supabase
    .from("episodes")
    .update({ status: "generating" })
    .eq("id", episodeId);

  try {
    // 6. 构建 user prompt（只传该集大纲，不传整个剧本）
    const userParts: string[] = [];

    userParts.push("【剧本背景（简略）】");
    if (script?.synopsis) userParts.push(`故事梗概: ${script.synopsis}`);
    const genreText = script?.genre || story?.genre;
    if (genreText) userParts.push(`类型: ${genreText}`);
    if (script?.worldview) {
      userParts.push(`世界观: ${script.worldview}`);
    } else if (story?.raw_input) {
      userParts.push(`原始创意: ${story.raw_input}`);
    }
    if (story?.theme && !script?.synopsis) userParts.push(`题材: ${story.theme}`);
    if (script?.relationships) userParts.push(`角色关系: ${script.relationships}`);

    userParts.push(`\n【第 ${episodeNumber} 集大纲】`);
    userParts.push(`集标题: ${epOutline.title}`);
    userParts.push(`剧情大纲: ${epOutline.outline}`);

    if (script?.characters) {
      const chars = Array.isArray(script.characters)
        ? script.characters
        : JSON.parse(script.characters as string);
      userParts.push("\n【剧本角色】");
      for (const c of chars) {
        userParts.push(`- ${c.name} (${c.role}): ${c.description}`);
      }
    }

    if (characters && characters.length > 0) {
      userParts.push("\n【可用角色名（镜头中请使用这些名字）】");
      userParts.push(characters.map((c) => c.name).join(", "));
    }

    if (locations && locations.length > 0) {
      userParts.push("\n【可用场景名】");
      userParts.push(locations.map((l) => l.name).join(", "));
    }

    userParts.push(
      `\n请基于以上信息，只生成第 ${episodeNumber} 集《${epOutline.title}》的分镜列表。`
    );

    // 6.5 加载节点模板（数量变量由模板渲染注入；&episode_number 传当前集数）
    const episodeSystemPrompt = await getRenderedSystemPrompt(
      supabase, userId, projectId, "storyboard_episode", { episodeNumber }
    );
    const messages: ChatMessage[] = [
      { role: "system", content: episodeSystemPrompt },
      { role: "user", content: userParts.join("\n") },
    ];

    // 7. AI 生成
    const aiConfig = await getUserDefaultAIModel(supabase, userId);
    const episode = await AIService.generateJSON<GeneratedEpisode>(
      messages,
      { userId, projectId, type: GenerationType.STORYBOARD },
      { ...aiConfig },
      { supabase }
    );

    // 8. 删除该集旧的 scenes/shots（保留 episode 记录，只删子数据）
    await supabase.from("scenes").delete().eq("episode_id", episodeId);

    // 9. 构建映射
    const charMap = new Map<string, string>();
    if (characters) {
      for (const c of characters) charMap.set(c.name, c.id);
    }
    const locMap = new Map<string, string>();
    if (locations) {
      for (const l of locations) locMap.set(l.name, l.id);
    }

    // 10. 更新 episode 状态 —— 只写 status，不反向覆盖 title/summary
    //     （依赖链方向：剧情大纲是 title/summary 的权威产出层，分镜只消费、不回写）
    const { error: epError } = await supabase
      .from("episodes")
      .update({
        status: "storyboarded",
      })
      .eq("id", episodeId);

    if (epError) {
      throw new Error(`更新剧集失败: ${epError.message}`);
    }

    // 分镜内容已重建 → 递增 storyboard_version，
    // 使该集下游画面指令在前端判定为「需重新生成」（旧 prompts 已随 scenes 级联删除）
    await Episodes.bumpStoryboardVersion(episodeId, { supabase });

    const createdSceneIds: string[] = [];

    for (const sc of episode.scenes) {
      const locationId = locMap.get(sc.location_name) || null;

      const { data: scene, error: scError } = await supabase
        .from("scenes")
        .insert({
          episode_id: episodeId,
          location_id: locationId,
          scene_number: sc.scene_number,
          location_name: sc.location_name,
          time: sc.time || null,
          weather: sc.weather || null,
        })
        .select("id")
        .single();

      if (scError || !scene) {
        throw new Error(`创建场景失败: ${scError?.message}`);
      }

      createdSceneIds.push(scene.id);

      for (const sh of sc.shots) {
        const characterIds = (sh.character_names || [])
          .map((name) => charMap.get(name))
          .filter((id): id is string => !!id);

        // 插入 shot（不再存 character_ids，改用 shot_characters 关联表）
        const { data: newShot, error: shError } = await supabase
          .from("shots")
          .insert({
            scene_id: scene.id,
            shot_number: sh.shot_number,
            description: sh.description,
            action: sh.action || null,
            emotion: sh.emotion || null,
            environment: sh.environment || null,
            cinematography: sh.cinematography || null,
            dialogue: sh.dialogue || null,
          })
          .select("id")
          .single();

        if (shError || !newShot) {
          throw new Error(`创建镜头失败: ${shError?.message}`);
        }

        // 写入 shot_characters 关联表
        if (characterIds.length > 0) {
          const scRows = characterIds.map((charId, idx) => ({
            shot_id: newShot.id,
            character_id: charId,
            sort_order: idx,
          }));
          const { error: scErr } = await supabase
            .from("shot_characters")
            .insert(scRows);
          if (scErr) {
            throw new Error(`写入镜头角色关联失败: ${scErr.message}`);
          }
        }
      }
    }

    // 10.5. 为本集所有 Scene 创建 storyboards 记录（status='draft'）
    if (createdSceneIds.length > 0) {
      const sbRows = createdSceneIds.map((sceneId) => ({
        scene_id: sceneId,
        project_id: projectId,
        status: "draft",
        image_refs: [],
        is_stale: false,
        version_number: 1,
      }));
      const { error: sbError } = await supabase
        .from("storyboards")
        .insert(sbRows);
      if (sbError) {
        console.error(`创建 Storyboard 记录失败: ${sbError.message}`);
      }
    }

    // 11. 更新项目状态
    await supabase
      .from("projects")
      .update({ status: "storyboarding" })
      .eq("id", projectId);

    return episode;
  } catch (error) {
    // 失败时标记 episode 状态
    await supabase
      .from("episodes")
      .update({ status: "failed" })
      .eq("id", episodeId);
    throw error;
  }
}
