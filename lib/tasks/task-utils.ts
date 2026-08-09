// ============================================
// 任务共用工具 — lock / progress / heartbeat / finalize
// 从 initialize-assets.ts 抽出，供所有 task handler 共用
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** 任务行类型 */
export interface TaskRow {
  id: string;
  project_id: string;
  user_id: string;
  task_type: string;
  payload: Record<string, unknown>;
  attempt: number;
}

/**
 * 原子锁定任务：pending → running + attempt+1
 * 使用 RPC 一次完成，避免竞态
 */
export async function lockTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<TaskRow | null> {
  const { data, error } = await supabase.rpc("lock_project_task", {
    p_task_id: taskId,
  });

  if (error || !data || data.length === 0) {
    return null;
  }

  return data[0] as TaskRow;
}

/**
 * 更新进度（JSONB merge，不覆盖其他 key）
 */
export async function updateProgress(
  supabase: SupabaseClient,
  taskId: string,
  patch: Record<string, string>
): Promise<void> {
  await supabase.rpc("merge_task_progress", {
    p_task_id: taskId,
    p_patch: patch,
  });
}

/**
 * Heartbeat — 更新 locked_at 证明存活
 */
export async function heartbeat(
  supabase: SupabaseClient,
  taskId: string
): Promise<void> {
  await supabase.rpc("heartbeat_task", { p_task_id: taskId });
}

/**
 * 启动 heartbeat 定时器（每 30s）
 * 返回 clear 函数，在 finally 中调用
 */
export function startHeartbeat(
  supabase: SupabaseClient,
  taskId: string
): () => void {
  const timer = setInterval(() => {
    heartbeat(supabase, taskId).catch(() => {});
  }, 30_000);

  return () => clearInterval(timer);
}

/**
 * 标记任务最终状态
 * 如果任务已被 force-reset（status="failed"），不覆盖
 * @param ok 是否成功
 * @param errorMsg 失败时的错误信息
 */
export async function finalizeTask(
  supabase: SupabaseClient,
  taskId: string,
  ok: boolean,
  errorMsg?: string
): Promise<void> {
  // 检查任务是否被用户 force-reset
  const { data: current } = await supabase
    .from("project_tasks")
    .select("status")
    .eq("id", taskId)
    .single();

  if (current?.status === "failed") {
    // 任务已被 force-reset，不覆盖状态
    return;
  }

  await supabase
    .from("project_tasks")
    .update({
      status: ok ? "success" : "failed",
      error: errorMsg ? { reason: errorMsg } : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", taskId);
}
