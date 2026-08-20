// ============================================
// AI Action - 逐集剧情/分镜大纲生成
// 剧本架构 Phase 2：以故事创意(stories，初始化产出)为背景，
//   逐集扩写「剧情大纲」(episodes.plot_outline)，
//   再由剧情大纲逐集派生「分镜大纲」(episodes.shot_outline)。
//   （兼容旧链路 scripts 剧本骨架作为背景与分集梗概来源）
// 每层写入独立版本号，为下游过期判定提供基线。
// 依赖链：剧情大纲 → 分镜大纲 → 分镜内容 → 画面指令。
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRenderedSystemPrompt, SERIALIZATION_MODE_LABELS } from "@/lib/ai/node-template-loader";
import * as Episodes from "@/lib/models/episodes";
import type { PlotOutline, ShotOutline } from "@/lib/models/episodes";
import { runImpact } from "@/lib/lifecycle/impact-engine";

export interface AIActionContext {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

// ============================================
// 1. 逐集生成剧情大纲
// ============================================

/**
 * 逐集生成剧情大纲 —— 写入 episodes.plot_outline，plot_version +1
 */
export async function generateEpisodePlot(
  projectId: string,
  episodeNumber: number,
  userId: string,
  ctx?: AIActionContext
): Promise<PlotOutline> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  // 1. 定位目标集
  const episode = await Episodes.getByNumber(projectId, episodeNumber, { supabase });
  if (!episode) {
    throw new Error(`第 ${episodeNumber} 集不存在，请先完成项目初始化`);
  }

  // 2. 读取整体背景 —— 优先 stories（初始化故事创意，新架构权威数据源），
  //    兼容回退 scripts（旧链路数据）；两者皆无视为初始化未完成
  const [scriptRes, storyRes] = await Promise.all([
    supabase
      .from("scripts")
      .select("synopsis, worldview, relationships, episode_outline")
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

  const hasScriptSkeleton = !!(script?.synopsis || script?.worldview);
  const hasStoryIdea = !!(story?.raw_input || story?.theme);
  if (!hasScriptSkeleton && !hasStoryIdea) {
    throw new Error(`项目缺少故事创意数据，请先完成项目初始化`);
  }

  // 3. 本集分集梗概：scripts.episode_outline（旧链路）→ 已有 plot_outline.summary（重生成场景）
  //    都没有时基于整体背景让 AI 自主规划（不再强制先生成剧本骨架）
  let episodeBrief = "";
  const outlineArr = (script?.episode_outline as Array<{ episode: number; title: string; outline: string }>) || [];
  const matched = outlineArr.find((o) => o.episode === episodeNumber);
  if (matched?.outline) {
    episodeBrief = matched.outline;
  } else if (episode.plot_outline?.summary) {
    episodeBrief = episode.plot_outline.summary;
  }

  // 4. 读取角色资产（约束 AI 只用已有角色）
  const { data: characters } = await supabase
    .from("characters")
    .select("name")
    .eq("project_id", projectId)
    .order("sort_order");

  // 4.5 读取连载模式，决定逐集生成的上下文策略
  //   continuous 连续剧情：读取第 1~N-1 集剧情摘要作为上下文
  //   episodic   单元剧：   每集独立生成，只共享角色/场景/世界观
  //   mixed      混合：     读取主线进度简表 + 本集独立设定
  const { data: projRow } = await supabase
    .from("projects")
    .select("serialization_mode")
    .eq("id", projectId)
    .single();
  const serializationMode = projRow?.serialization_mode ?? "continuous";

  // 连载模式文案统一来自 loader 的 SERIALIZATION_MODE_LABELS（&serialization_mode_label 同源）
  let prevContext = "";
  if (serializationMode !== "episodic" && episodeNumber > 1) {
    const { data: prevEpisodes } = await supabase
      .from("episodes")
      .select("episode_number, title, plot_outline")
      .eq("project_id", projectId)
      .lt("episode_number", episodeNumber)
      .order("episode_number");

    const prevList = (prevEpisodes ?? []).filter(
      (e) => (e.plot_outline as { summary?: string } | null)?.summary
    );
    if (prevList.length > 0) {
      if (serializationMode === "continuous") {
        // 完整注入前集剧情摘要，保证强关联连贯
        const lines = prevList.map(
          (e) =>
            `第${e.episode_number}集${e.title ? `《${e.title}》` : ""}: ${
              (e.plot_outline as { summary?: string }).summary
            }`
        );
        prevContext = `\n【前集剧情（第 1~${episodeNumber - 1} 集，本集必须自然承接）】\n${lines.join("\n")}`;
      } else {
        // mixed：只注入主线进度简表 + 最近一集摘要，保留本集独立空间
        const mainLine = prevList
          .map((e) => `第${e.episode_number}集${e.title ? `《${e.title}》` : ""}`)
          .join(" → ");
        const last = prevList[prevList.length - 1];
        prevContext = `\n【主线进度（已发生集目）】\n${mainLine}\n最近一集剧情: ${
          (last.plot_outline as { summary?: string }).summary
        }`;
      }
    }
  }

  // 5. 构建 user prompt
  const parts: string[] = [];
  parts.push(`【连载模式】${SERIALIZATION_MODE_LABELS[serializationMode] ?? SERIALIZATION_MODE_LABELS.continuous}`);
  if (hasScriptSkeleton) {
    parts.push("\n【整体剧本骨架】");
    if (script?.synopsis) parts.push(`故事梗概: ${script.synopsis}`);
    if (script?.worldview) parts.push(`世界观: ${script.worldview}`);
    if (script?.relationships) parts.push(`角色关系: ${script.relationships}`);
  } else if (story) {
    parts.push("\n【整体背景（项目故事创意）】");
    if (story.raw_input) parts.push(`原始创意: ${story.raw_input}`);
    if (story.theme) parts.push(`题材: ${story.theme}`);
    if (story.genre) parts.push(`类型: ${story.genre}`);
    if (story.core_conflict) parts.push(`核心冲突: ${story.core_conflict}`);
    if (story.target_emotion) parts.push(`目标情绪: ${story.target_emotion}`);
  }
  if (characters && characters.length > 0) {
    parts.push(`已有角色: ${characters.map((c) => c.name).join("、")}`);
  }
  if (prevContext) parts.push(prevContext);
  parts.push(`\n【本集信息】第 ${episodeNumber} 集${episode.title ? ` · ${episode.title}` : ""}`);
  if (episodeBrief) {
    parts.push(`分集梗概: ${episodeBrief}`);
  }
  parts.push("\n请将本集扩写成结构化剧情大纲。");

  // 5. 加载节点模板（modeAware：loader 按项目连载模式选模板；&episode_number 传当前集数）
  const plotSystemPrompt = await getRenderedSystemPrompt(
    supabase, userId, projectId, "episode_plot", { episodeNumber }
  );
  const messages: ChatMessage[] = [
    { role: "system", content: plotSystemPrompt },
    { role: "user", content: parts.join("\n") },
  ];

  // 6. 调用 AI
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const generated = await AIService.generateJSON<PlotOutline>(
    messages,
    { userId, projectId, type: GenerationType.SCRIPT },
    { ...aiConfig },
    { supabase }
  );

  // 7. 写入 + plot_version +1（下游分镜大纲/分镜内容/画面指令全部需重新评估）
  //    剧情大纲是集标题/梗概的权威产出层：AI 产出的 title/summary 一并写入
  await Episodes.updatePlot(
    episode.id,
    {
      plot_outline: generated,
      title: generated.title || episode.title,
      summary: generated.summary || episode.summary,
    },
    { supabase }
  );

  // 8. 触发影响传播（同步执行，已在异步任务上下文中）：该集已有分镜内容 → 标记下游 stale
  //    同步跑而非创建 impact 任务：避免异步任务延迟执行时，把期间已重建的下游误标脏
  await runImpact(
    {
      entity_type: "episode_plot",
      entity_id: episode.id,
      project_id: projectId,
    },
    { supabase }
  );

  return generated;
}

// ============================================
// 2. 逐集生成分镜大纲
// ============================================

/**
 * 逐集生成分镜大纲 —— 写入 episodes.shot_outline，outline_version +1
 * 同时钉住 outline_based_on_plot_version（用于「上游脏」判定）
 */
export async function generateEpisodeShotOutline(
  projectId: string,
  episodeNumber: number,
  userId: string,
  ctx?: AIActionContext
): Promise<ShotOutline> {
  const supabase = ctx?.supabase ?? (await getDefaultClient());

  const episode = await Episodes.getByNumber(projectId, episodeNumber, { supabase });
  if (!episode) {
    throw new Error(`第 ${episodeNumber} 集不存在`);
  }
  if (!episode.plot_outline) {
    throw new Error(`请先生成第 ${episodeNumber} 集的剧情大纲`);
  }

  // 读取场景库供 AI 参考地点
  const { data: locations } = await supabase
    .from("locations")
    .select("name")
    .eq("project_id", projectId);

  // 构建 user prompt —— 把剧情大纲结构化内容喂给 AI
  const plot = episode.plot_outline;
  const parts: string[] = [];
  parts.push(`【第 ${episodeNumber} 集剧情大纲】`);
  if (plot.opening) parts.push(`开场: ${plot.opening}`);
  if (plot.turning_point) parts.push(`转折: ${plot.turning_point}`);
  if (plot.conflict) parts.push(`冲突: ${plot.conflict}`);
  if (plot.ending) parts.push(`结尾: ${plot.ending}`);
  if (plot.emotional_tone) parts.push(`情绪走向: ${plot.emotional_tone}`);
  if (plot.summary && !plot.opening) parts.push(`梗概: ${plot.summary}`);
  if (locations && locations.length > 0) {
    parts.push(`\n可用场景: ${locations.map((l) => l.name).join("、")}`);
  }
  parts.push("\n请将本集剧情拆解为分镜大纲（场景规划）。");

  // 加载节点模板（modeAware：loader 按项目连载模式选模板；数量变量由模板渲染注入）
  const shotOutlineSystemPrompt = await getRenderedSystemPrompt(
    supabase, userId, projectId, "shot_outline", { episodeNumber }
  );
  const messages: ChatMessage[] = [
    { role: "system", content: shotOutlineSystemPrompt },
    { role: "user", content: parts.join("\n") },
  ];

  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const generated = await AIService.generateJSON<ShotOutline>(
    messages,
    { userId, projectId, type: GenerationType.SCRIPT },
    { ...aiConfig },
    { supabase }
  );

  // 写入 + outline_version +1 + 钉住依据的 plot_version
  await Episodes.updateShotOutline(episode.id, { shot_outline: generated }, { supabase });

  // 触发影响传播（同步执行，已在异步任务上下文中）：该集已有分镜内容 → 标记下游 stale
  await runImpact(
    {
      entity_type: "episode_outline",
      entity_id: episode.id,
      project_id: projectId,
    },
    { supabase }
  );

  return generated;
}
