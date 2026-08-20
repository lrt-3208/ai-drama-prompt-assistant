// ============================================
// 通用任务执行器 — 处理 regenerate_*/generate_* 任务
// 与 executeInitializeTask 共用 lockTask/startHeartbeat/finalizeTask
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enrichStory,
  generateCharacters,
  generateLocations,
  generateStyle,
  type AIActionContext,
} from "@/lib/ai-actions/assets";
import { generateScript } from "@/lib/ai-actions/script";
import {
  generateEpisodePlot,
  generateEpisodeShotOutline,
} from "@/lib/ai-actions/episode-plot";
import {
  generateStoryboard,
  generateEpisodeStoryboard,
  type AIActionContext as StoryboardActionContext,
} from "@/lib/ai-actions/storyboard";
import {
  generateStoryboardAsset,
  type AIActionContext as StoryboardAssetActionContext,
} from "@/lib/ai-actions/storyboard-asset";
import { generateImagePrompt } from "@/lib/prompt-engine/prompt-generator";
import { generateSceneVideoPrompt } from "@/lib/prompt-engine/scene-video-prompt-generator";
import { evaluatePromptQuality } from "@/lib/prompt-engine/prompt-evaluator";
import type { PromptEngineContext } from "@/lib/prompt-engine/context-builder";
import { generateStoryboardImage } from "@/lib/storyboard/image-generator";
import type { ImageGeneratorContext } from "@/lib/storyboard/image-generator";
import { runImpact, type ImpactPayload } from "@/lib/lifecycle/impact-engine";
import { runIncrementalRegen } from "@/lib/lifecycle/incremental-regen";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import { lockTask, startHeartbeat, finalizeTask } from "./task-utils";

/**
 * 执行生成任务（非 initialize_assets 类型的所有任务）
 *
 * 流程：
 * 1. 原子锁定（lock_project_task RPC）
 * 2. 根据 task_type dispatch 到对应的 AI 函数
 * 3. 标记最终状态（success / failed）
 *
 * 僵尸回收由 task-runner 在调用前执行
 * heartbeat 每 30s 更新 locked_at
 */
export async function executeGenerationTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<void> {
  // 1. 原子锁定
  const task = await lockTask(supabase, taskId);
  if (!task) {
    return;
  }

  // model_snapshot — 记录任务使用的 AI 模型快照（业务层直接 update，无 RPC）
  // generate_storyboard_image 不调用 AI，跳过 model config 读取
  const skipModelConfig = task.task_type === "generate_storyboard_image";
  if (!skipModelConfig) {
    const modelConfig = await getUserDefaultAIModel(
      supabase,
      task.user_id,
      "text"
    );
    await supabase.from("project_tasks").update({
      payload: {
        ...task.payload,
        model_snapshot: {
          provider: modelConfig.provider,
          model: modelConfig.model,
        },
      },
    }).eq("id", taskId);
  }

  const ctx: AIActionContext & StoryboardActionContext & StoryboardAssetActionContext & PromptEngineContext & ImageGeneratorContext = { supabase };
  const payload = task.payload || {};
  let ok = false;
  let errorMsg: string | undefined;

  // 启动 heartbeat
  const stopHeartbeat = startHeartbeat(supabase, taskId);

  try {
    switch (task.task_type) {
      case "regenerate_story":
        await enrichStory(task.project_id, task.user_id, ctx);
        break;

      case "regenerate_characters":
        await generateCharacters(
          task.project_id,
          task.user_id,
          payload.customPrompt as string | undefined,
          ctx
        );
        break;

      case "regenerate_locations":
        await generateLocations(
          task.project_id,
          task.user_id,
          payload.customPrompt as string | undefined,
          ctx
        );
        break;

      case "regenerate_style":
        await generateStyle(
          task.project_id,
          task.user_id,
          payload.customPrompt as string | undefined,
          ctx
        );
        break;

      case "generate_script":
        await generateScript(task.project_id, task.user_id, ctx);
        break;

      case "generate_episode_plot":
        await generateEpisodePlot(
          task.project_id,
          payload.episodeNumber as number,
          task.user_id,
          ctx
        );
        break;

      case "generate_episode_outline":
        await generateEpisodeShotOutline(
          task.project_id,
          payload.episodeNumber as number,
          task.user_id,
          ctx
        );
        break;

      case "generate_storyboard":
        await generateStoryboard(task.project_id, task.user_id, ctx);
        break;

      case "generate_storyboard_episode":
        await generateEpisodeStoryboard(
          task.project_id,
          payload.episodeNumber as number,
          task.user_id,
          ctx
        );
        break;

      case "generate_prompt":
        await generateImagePrompt(
          payload.shotId as string,
          task.project_id,
          task.user_id,
          payload.platform as string,
          (payload.language as "zh" | "en") || "zh",
          ctx
        );
        break;

      case "generate_storyboard_asset":
        await generateStoryboardAsset(
          payload.sceneId as string,
          task.project_id,
          task.user_id,
          ctx
        );
        break;

      case "generate_scene_video_prompt":
        await generateSceneVideoPrompt(
          payload.sceneId as string,
          task.project_id,
          task.user_id,
          (payload.platform as string) || "jimeng",
          (payload.language as "zh" | "en") || "zh",
          ctx
        );
        break;

      case "run_impact":
        await runImpact(
          payload as unknown as ImpactPayload,
          ctx
        );
        break;

      case "run_regen":
        await runIncrementalRegen(
          task.project_id,
          task.user_id,
          ctx
        );
        break;

      case "evaluate_prompt":
        await evaluatePromptQuality(
          payload.promptId as string,
          task.user_id,
          ctx
        );
        break;

      case "generate_storyboard_image":
        await generateStoryboardImage(
          payload.sceneId as string,
          task.project_id,
          task.user_id,
          payload.screenshotTosKey as string,
          ctx
        );
        break;

      default:
        throw new Error(`未知的任务类型: ${task.task_type}`);
    }
    ok = true;
  } catch (e) {
    errorMsg = (e as Error).message;
  } finally {
    stopHeartbeat();
  }

  // 标记最终状态
  await finalizeTask(supabase, taskId, ok, errorMsg);
}
