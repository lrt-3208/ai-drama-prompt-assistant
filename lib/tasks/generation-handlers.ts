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
  generateStoryboard,
  generateEpisodeStoryboard,
  type AIActionContext as StoryboardActionContext,
} from "@/lib/ai-actions/storyboard";
import { generateImagePrompt, generateVideoPrompt } from "@/lib/prompt-engine/prompt-generator";
import type { PromptEngineContext } from "@/lib/prompt-engine/context-builder";
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

  const ctx: AIActionContext & StoryboardActionContext & PromptEngineContext = { supabase };
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
        if (payload.promptType === "image") {
          await generateImagePrompt(
            payload.shotId as string,
            task.project_id,
            task.user_id,
            payload.platform as string,
            (payload.language as "zh" | "en") || "zh",
            ctx
          );
        } else {
          await generateVideoPrompt(
            payload.shotId as string,
            task.project_id,
            task.user_id,
            payload.platform as string,
            (payload.language as "zh" | "en") || "zh",
            ctx
          );
        }
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
