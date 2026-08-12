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
import { getGenerationConfig, type GenerationConfig } from "@/lib/ai-actions/config";

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

/** 分镜生成的 system prompt（根据配置动态生成） */
function buildStoryboardSystemPrompt(config: GenerationConfig): string {
  return `你是一位专业的短剧分镜师。根据剧本内容，将故事拆解为分镜列表。

【语言要求】所有字段内容（title/summary/description/action/emotion/environment/cinematography/dialogue/location_name/time/weather）必须用中文输出。

要求：
1. 生成 ${config.episode_count.min}-${config.episode_count.max} 个剧集（episode），每集是一个独立的故事单元
2. 每个剧集包含 ${config.scenes_per_episode.min}-${config.scenes_per_episode.max} 个场景（scene）
3. 每个场景包含 ${config.shots_per_scene.min}-${config.shots_per_scene.max} 个镜头（shot）
4. 每个镜头包含：
   - shot_number: 镜头编号（在当前场景内从 1 开始）
   - description: 画面描述（镜头看到什么）
   - action: 角色动作描述
   - emotion: 情绪表达
   - environment: 环境细节
   - cinematography: 摄影手法（如：特写、中景、全景、推镜、摇镜等）
   - dialogue: 对白（如果没有对白则留空）
   - character_names: 出场角色名字列表（必须使用已有角色名）

剧集划分原则：
- 每集有明确的核心冲突和高潮
- 剧集之间有连贯性，前集结尾为后集铺垫
- 第一集要抓人眼球，中间集推进剧情，最后一集收束

请以 JSON 格式输出，不要输出任何其他内容。格式如下：
{
  "episodes": [{
    "episode_number": 1,
    "title": "...",
    "summary": "...",
    "scenes": [{
      "scene_number": 1,
      "location_name": "...",
      "time": "...",
      "weather": "...",
      "shots": [{
        "shot_number": 1,
        "description": "...",
        "action": "...",
        "emotion": "...",
        "environment": "...",
        "cinematography": "...",
        "dialogue": "...",
        "character_names": ["角色名"]
      }]
    }]
  }]
}`;
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

  // 0. 读取生成数量配置
  const genConfig = await getGenerationConfig(projectId, { supabase });

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

  const messages: ChatMessage[] = [
    { role: "system", content: buildStoryboardSystemPrompt(genConfig) },
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

  // 6. 清理旧的分镜数据（删除旧 episodes 会级联删除 scenes 和 shots）
  await supabase
    .from("episodes")
    .delete()
    .eq("project_id", projectId);

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
    // 插入 episode
    const { data: episode, error: epError } = await supabase
      .from("episodes")
      .insert({
        project_id: projectId,
        episode_number: ep.episode_number,
        title: ep.title,
        summary: ep.summary,
        status: "storyboarded",
      })
      .select("id")
      .single();

    if (epError || !episode) {
      throw new Error(`创建剧集失败: ${epError?.message}`);
    }

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

/** 单集分镜生成的 system prompt（根据配置动态生成） */
function buildEpisodeSystemPrompt(config: GenerationConfig): string {
  return `你是一位专业的短剧分镜师。根据提供的某一集剧情大纲，生成分镜列表。

【语言要求】所有字段内容（title/summary/description/action/emotion/environment/cinematography/dialogue/location_name/time/weather）必须用中文输出。

要求：
1. 只生成指定的这一集，不要生成其他集
2. 包含 ${config.scenes_per_episode.min}-${config.scenes_per_episode.max} 个场景（scene）
3. 每个场景包含 ${config.shots_per_scene.min}-${config.shots_per_scene.max} 个镜头（shot）
4. 每个镜头包含：
   - shot_number: 镜头编号（在当前场景内从 1 开始）
   - description: 画面描述（镜头看到什么）
   - action: 角色动作描述
   - emotion: 情绪表达
   - environment: 环境细节
   - cinematography: 摄影手法（如：特写、中景、全景、推镜、摇镜等）
   - dialogue: 对白（如果没有对白则留空）
   - character_names: 出场角色名字列表（必须使用已有角色名）

请以 JSON 格式输出，不要输出任何其他内容。格式如下：
{
  "episode_number": 1,
  "title": "...",
  "summary": "...",
  "scenes": [{
    "scene_number": 1,
    "location_name": "...",
    "time": "...",
    "weather": "...",
    "shots": [{
      "shot_number": 1,
      "description": "...",
      "action": "...",
      "emotion": "...",
      "environment": "...",
      "cinematography": "...",
      "dialogue": "...",
      "character_names": ["角色名"]
    }]
  }]
}`;
}

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

  // 0. 读取生成数量配置
  const genConfig = await getGenerationConfig(projectId, { supabase });

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

  // 1. 读取剧本数据
  const { data: script, error: scriptError } = await supabase
    .from("scripts")
    .select("synopsis, genre, relationships, worldview, characters, episode_outline")
    .eq("project_id", projectId)
    .single();

  if (scriptError || !script) {
    throw new Error("请先生成剧本后再按集生成分镜");
  }

  // 2. 提取该集 episode_outline
  const episodeOutlines = Array.isArray(script.episode_outline)
    ? script.episode_outline
    : [];

  const epOutline = episodeOutlines.find(
    (e: { episode: number }) => e.episode === episodeNumber
  );

  if (!epOutline) {
    throw new Error(`剧本中没有第 ${episodeNumber} 集的大纲，请重新生成剧本`);
  }

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
  // 对于不存在的 episode（待生成集），先创建一条 generating 记录
  let episodeId: string;
  if (existingEp?.id) {
    await supabase
      .from("episodes")
      .update({ status: "generating" })
      .eq("id", existingEp.id);
    episodeId = existingEp.id;
  } else {
    const { data: placeholderEp, error: placeholderError } = await supabase
      .from("episodes")
      .insert({
        project_id: projectId,
        episode_number: episodeNumber,
        title: epOutline.title,
        summary: epOutline.outline,
        status: "generating",
      })
      .select("id")
      .single();

    if (placeholderError || !placeholderEp) {
      throw new Error(`创建剧集记录失败: ${placeholderError?.message}`);
    }
    episodeId = placeholderEp.id;
  }

  try {
    // 6. 构建 user prompt（只传该集大纲，不传整个剧本）
    const userParts: string[] = [];

    userParts.push("【剧本背景（简略）】");
    userParts.push(`类型: ${script.genre || ""}`);
    if (script.worldview) userParts.push(`世界观: ${script.worldview}`);
    if (script.relationships) userParts.push(`角色关系: ${script.relationships}`);

    userParts.push(`\n【第 ${episodeNumber} 集大纲】`);
    userParts.push(`集标题: ${epOutline.title}`);
    userParts.push(`剧情大纲: ${epOutline.outline}`);

    if (script.characters) {
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

    const messages: ChatMessage[] = [
      { role: "system", content: buildEpisodeSystemPrompt(genConfig) },
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

    // 10. 更新 episode 记录（用 AI 生成结果覆盖，不再删除重插）
    const { error: epError } = await supabase
      .from("episodes")
      .update({
        title: episode.title,
        summary: episode.summary,
        status: "storyboarded",
      })
      .eq("id", episodeId);

    if (epError) {
      throw new Error(`更新剧集失败: ${epError.message}`);
    }

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
