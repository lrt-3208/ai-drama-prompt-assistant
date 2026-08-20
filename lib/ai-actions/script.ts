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
import { getRenderedSystemPrompt } from "@/lib/ai/node-template-loader";

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

  if (!characters || characters.length === 0) {
    throw new Error("请先生成角色后再生成剧本");
  }

  // 3. 读取场景资产
  const { data: locations } = await supabase
    .from("locations")
    .select("name, description, environment, time, weather")
    .eq("project_id", projectId);

  if (!locations || locations.length === 0) {
    throw new Error("请先生成场景后再生成剧本");
  }

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

  // 5. 加载节点模板（分集数量变量由模板渲染注入；modeAware 节点按项目连载模式选模板）
  const scriptSystemPrompt = await getRenderedSystemPrompt(supabase, userId, projectId, "script");
  const messages: ChatMessage[] = [
    { role: "system", content: scriptSystemPrompt },
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
