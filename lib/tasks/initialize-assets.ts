// ============================================
// 任务执行器 — initialize_assets 任务
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enrichStory,
  generateCharacters,
  generateLocations,
  generateStyle,
  type AIActionContext,
} from "@/lib/ai-actions/assets";
import { getGenerationConfig } from "@/lib/ai-actions/config";
import * as Episodes from "@/lib/models/episodes";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import {
  lockTask,
  updateProgress,
  startHeartbeat,
} from "./task-utils";

/**
 * 执行 initialize_assets 任务
 *
 * 流程：
 * 1. 原子锁定（lock_project_task RPC）
 * 2. 第一阶段：enrichStory（串行）
 * 3. 第二阶段：Promise.allSettled(characters, locations, style, episodes 骨架)
 * 4. 更新最终状态 + progress + error
 * 5. 同步 projects.asset_status
 *
 * Episode 骨架为纯 DB 操作（无 AI 调用），按 generation_config.episode_count.max
 * 创建空壳集（仅集号 + draft 状态），对照原型 02-init.html 第 5 步。
 *
 * 僵尸回收由 task-runner 在调用前执行（见 task-runner/route.ts）
 * heartbeat 每 30s 更新 locked_at
 */
export async function executeInitializeTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<void> {
  // 1. 原子锁定
  const task = await lockTask(supabase, taskId);
  if (!task) {
    // 已被其他 runner 锁定或不存在
    return;
  }

  // model_snapshot — 记录任务使用的 AI 模型快照（业务层直接 update，无 RPC）
  const modelConfig = await getUserDefaultAIModel(supabase, task.user_id, "text");
  await supabase.from("project_tasks").update({
    payload: {
      ...task.payload,
      model_snapshot: {
        provider: modelConfig.provider,
        model: modelConfig.model,
      },
    },
  }).eq("id", taskId);

  const ctx: AIActionContext = { supabase };
  const results: Record<string, { ok: boolean; error?: string }> = {
    story: { ok: false },
    characters: { ok: false },
    locations: { ok: false },
    style: { ok: false },
    episodes: { ok: false },
  };

  // 初始化 progress
  await updateProgress(supabase, taskId, {
    story: "pending",
    characters: "pending",
    locations: "pending",
    style: "pending",
    episodes: "pending",
  });

  // 启动 heartbeat（每 30s）
  const stopHeartbeat = startHeartbeat(supabase, taskId);

  try {
    // 2. 第一阶段：enrichStory（串行）
    try {
      await enrichStory(task.project_id, task.user_id, ctx);
      results.story = { ok: true };
      await updateProgress(supabase, taskId, {
        story: "success",
        characters: "running",
        locations: "running",
        style: "running",
      });
    } catch (e) {
      results.story = { ok: false, error: (e as Error).message };
      await updateProgress(supabase, taskId, { story: "failed" });
    }

    // 3. 第二阶段：并行（仅 story 成功时）
    if (results.story.ok) {
      await updateProgress(supabase, taskId, {
        characters: "running",
        locations: "running",
        style: "running",
        episodes: "running",
      });

      // Episode 骨架数取生成配置的上限值（纯 DB 操作，无 AI 调用）
      const genConfig = await getGenerationConfig(task.project_id, { supabase });

      const [charR, locR, styleR, epR] = await Promise.allSettled([
        generateCharacters(task.project_id, task.user_id, undefined, ctx),
        generateLocations(task.project_id, task.user_id, undefined, ctx),
        generateStyle(task.project_id, task.user_id, undefined, ctx),
        Episodes.ensureSkeletons(
          task.project_id,
          genConfig.episode_count.max,
          { supabase }
        ),
      ]);

      results.characters = charR.status === "fulfilled"
        ? { ok: true }
        : { ok: false, error: (charR.reason as Error)?.message || "角色生成失败" };

      results.locations = locR.status === "fulfilled"
        ? { ok: true }
        : { ok: false, error: (locR.reason as Error)?.message || "场景生成失败" };

      results.style = styleR.status === "fulfilled"
        ? { ok: true }
        : { ok: false, error: (styleR.reason as Error)?.message || "风格生成失败" };

      results.episodes = epR.status === "fulfilled"
        ? { ok: true }
        : { ok: false, error: (epR.reason as Error)?.message || "Episode 骨架创建失败" };

      // 更新 progress（merge，不覆盖 story）
      await updateProgress(supabase, taskId, {
        characters: results.characters.ok ? "success" : "failed",
        locations: results.locations.ok ? "success" : "failed",
        style: results.style.ok ? "success" : "failed",
        episodes: results.episodes.ok ? "success" : "failed",
      });
    }
  } finally {
    stopHeartbeat();
  }

  // 检查任务是否被用户 force-reset（status 被外部改为 "failed"）
  // 如果被 force-reset，不再覆盖任务状态和项目状态
  const { data: currentTask } = await supabase
    .from("project_tasks")
    .select("status")
    .eq("id", taskId)
    .single();

  if (currentTask?.status === "failed") {
    // 任务已被 force-reset，不覆盖状态
    return;
  }

  // 4. 最终状态
  const successCount = Object.values(results).filter((r) => r.ok).length;
  const finalStatus =
    successCount === 5 ? "success" : successCount > 0 ? "partial" : "failed";

  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(results)) {
    if (!v.ok && v.error) errors[k] = v.error;
  }

  const progress: Record<string, string> = {};
  for (const [k, v] of Object.entries(results)) {
    progress[k] = v.ok ? "success" : "failed";
  }

  await supabase.from("project_tasks").update({
    status: finalStatus,
    error: Object.keys(errors).length > 0 ? errors : null,
    result: { successCount, totalCount: 5 },
    completed_at: new Date().toISOString(),
  }).eq("id", taskId);

  // 5. 同步 projects.asset_status（缓存快照）
  const assetStatus = finalStatus === "success" ? "initialized" : finalStatus;
  await supabase.from("projects").update({
    asset_status: assetStatus,
    asset_progress: progress,
    asset_error: Object.keys(errors).length > 0 ? errors : {},
  }).eq("id", task.project_id);
}
