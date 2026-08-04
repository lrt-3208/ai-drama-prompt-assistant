import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeInitializeTask } from "@/lib/tasks/initialize-assets";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";

// Vercel Pro: 最大 5 分钟执行时间
export const maxDuration = 300;

/**
 * POST /api/internal/task-runner
 *
 * 内部 API：执行 pending 任务
 * 需要验证 x-runner-key（secret 不出浏览器）
 *
 * 流程：
 * 1. 验证 runner secret
 * 2. 僵尸回收：清理 >6 分钟未 heartbeat 的 running 任务
 * 3. 获取任务（指定 taskId 或拾取最早的 pending）
 * 4. 执行 executeInitializeTask
 */
export async function POST(request: NextRequest) {
  // 1. 验证 server secret
  const runnerKey = request.headers.get("x-runner-key");
  if (!runnerKey || runnerKey !== process.env.RUNNER_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // 2. 僵尸回收：清理 >6 分钟未 heartbeat 的 running 任务
  // locked_at 是最后一次 heartbeat 时间，比 started_at 更准确
  await supabase
    .from("project_tasks")
    .update({
      status: "failed",
      error: { reason: "runner_timeout" },
      completed_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("locked_at", new Date(Date.now() - 6 * 60 * 1000).toISOString());

  // 3. 获取任务
  const body = await request.json().catch(() => ({}));
  let taskId: string | null = body.taskId || null;
  let taskType: string | null = null;

  if (taskId) {
    // 指定 taskId 模式：查任务类型
    const { data: task } = await supabase
      .from("project_tasks")
      .select("id, task_type, status")
      .eq("id", taskId)
      .maybeSingle();
    if (!task) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    taskType = task.task_type;
  } else {
    // 无 taskId 模式：拾取最早的 pending（未来 Cron 用）
    const { data: pendingTask } = await supabase
      .from("project_tasks")
      .select("id, task_type")
      .eq("status", "pending")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    taskId = pendingTask?.id || null;
    taskType = pendingTask?.task_type || null;
  }

  if (!taskId || !taskType) {
    return NextResponse.json({ message: "no pending tasks" });
  }

  // 4. 执行任务（根据 task_type dispatch）
  try {
    if (taskType === "initialize_assets") {
      await executeInitializeTask(supabase, taskId);
    } else {
      await executeGenerationTask(supabase, taskId);
    }
    return NextResponse.json({ taskId, status: "done" });
  } catch (e) {
    // 兜底：标记 failed
    await supabase
      .from("project_tasks")
      .update({
        status: "failed",
        error: { reason: (e as Error).message },
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    return NextResponse.json({
      taskId,
      status: "error",
      error: (e as Error).message,
    });
  }
}
