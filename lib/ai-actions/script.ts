// ============================================
// AI Action - 剧本生成
// 从故事输入（Story）+ 角色/场景资产，AI 生成结构化剧本
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import type { SupabaseClient } from "@supabase/supabase-js";

/** DI 上下文（与 assets.ts 一致） */
export interface AIActionContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** AI 生成的剧本结构 */
export interface GeneratedScript {
  synopsis: string;
  genre: string;
  characters: Array<{
    name: string;
    role: string;
    description: string;
  }>;
  relationships: string;
  worldview: string;
  plot_outline: Array<{
    scene: string;
    description: string;
    emotion: string;
  }>;
  episode_outline: Array<{
    episode: number;
    title: string;
    outline: string;
  }>;
}

/** 剧本生成的 system prompt */
const SCRIPT_SYSTEM_PROMPT = `你是一位专业的短剧编剧。根据用户提供的故事创意和已有资产（角色、场景），生成一份结构化剧本。

【语言要求】所有字段内容必须用中文输出。

要求：
1. synopsis: 100-200字的故事梗概
2. genre: 剧本类型（如：都市爱情、悬疑、家庭伦理、古装等）
3. characters: 主要角色列表，每个角色包含 name（名字）、role（主角/配角/反派）、description（简短描述）
4. relationships: 角色之间的关系描述（如："李明与王雪是前任恋人，因误会分手"）
5. worldview: 故事的世界观设定和时间背景
6. plot_outline: 故事大纲，分为多个剧情段落（不是拍摄场景），每个段落包含：
   - scene: 段落名称（如"背叛真相"、"重生开局"）
   - description: 该段落的剧情描述
   - emotion: 该段落的情绪基调（如：紧张、温馨、悲伤等）
   剧情段落代表故事的结构骨架，后续分镜生成时会自动分配到各集中
7. episode_outline: 分集大纲，将故事拆分为 3-5 集，每集包含：
   - episode: 集数（从1开始）
   - title: 集标题（如"雨夜重生"、"布局开始"）
   - outline: 该集剧情大纲（200字以内，含核心冲突和结局）
   分集原则：每集有明确核心冲突；集间有连贯性；第一集抓人眼球，最后一集收束

请以 JSON 格式输出，不要输出任何其他内容。JSON 格式如下：
{
  "synopsis": "...",
  "genre": "...",
  "characters": [{"name": "...", "role": "...", "description": "..."}],
  "relationships": "...",
  "worldview": "...",
  "plot_outline": [{"scene": "...", "description": "...", "emotion": "..."}],
  "episode_outline": [{"episode": 1, "title": "...", "outline": "..."}]
}`;

/**
 * 生成剧本
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @returns 生成的剧本数据
 */
export async function generateScript(
  projectId: string,
  userId: string,
  ctx?: AIActionContext
): Promise<GeneratedScript> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 读取故事数据
  const { data: story, error: storyError } = await supabase
    .from("stories")
    .select("*")
    .eq("project_id", projectId)
    .single();

  if (storyError || !story) {
    throw new Error("请先填写故事输入后再生成剧本");
  }

  // 2. 读取角色资产
  const { data: characters } = await supabase
    .from("characters")
    .select("name, age, gender, appearance, personality, background, clothing")
    .eq("project_id", projectId)
    .order("sort_order");

  // 3. 读取场景资产
  const { data: locations } = await supabase
    .from("locations")
    .select("name, description, environment, time, weather")
    .eq("project_id", projectId);

  // 4. 构建 user prompt
  const userParts: string[] = [];

  userParts.push("【故事创意】");
  userParts.push(`原始输入: ${story.raw_input}`);
  if (story.theme) userParts.push(`主题: ${story.theme}`);
  if (story.genre) userParts.push(`类型: ${story.genre}`);
  if (story.core_conflict) userParts.push(`核心冲突: ${story.core_conflict}`);
  if (story.target_emotion) userParts.push(`目标情绪: ${story.target_emotion}`);

  if (characters && characters.length > 0) {
    userParts.push("\n【已有角色】");
    for (const c of characters) {
      userParts.push(
        `- ${c.name}${c.age ? `(${c.age}岁)` : ""}${c.gender ? `/${c.gender}` : ""}: ${c.appearance || ""}${c.personality ? `，性格：${c.personality}` : ""}`
      );
    }
  }

  if (locations && locations.length > 0) {
    userParts.push("\n【已有场景】");
    for (const l of locations) {
      userParts.push(
        `- ${l.name}: ${l.description || ""}${l.environment ? `，环境：${l.environment}` : ""}${l.time ? `，时间：${l.time}` : ""}`
      );
    }
  }

  userParts.push(
    "\n请基于以上信息，生成一份完整的短剧剧本。如果角色或场景不足，可以补充新的角色和场景。"
  );

  const messages: ChatMessage[] = [
    { role: "system", content: SCRIPT_SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];

  // 5. 调用 AI 生成
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const script = await AIService.generateJSON<GeneratedScript>(
    messages,
    { userId, projectId, type: GenerationType.SCRIPT },
    { ...aiConfig },
    { supabase }
  );

  // 6. 保存到 scripts 表（upsert by project_id）— 保留用于快速查询
  const { data: saved, error: saveError } = await supabase
    .from("scripts")
    .upsert({
      project_id: projectId,
      synopsis: script.synopsis,
      genre: script.genre,
      characters: script.characters,
      relationships: script.relationships,
      worldview: script.worldview,
      plot_outline: script.plot_outline,
      episode_outline: script.episode_outline,
    })
    .select("*")
    .single();

  if (saveError) {
    throw new Error(`剧本保存失败: ${saveError.message}`);
  }

  // 7. 更新项目状态为 scripting
  await supabase
    .from("projects")
    .update({ status: "scripting" })
    .eq("id", projectId);

  return { ...script, id: saved.id } as GeneratedScript & { id: string };
}
