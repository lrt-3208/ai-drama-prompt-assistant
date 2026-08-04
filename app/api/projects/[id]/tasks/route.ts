import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

// 允许的 task_type 列表
const ALLOWED_TASK_TYPES = [
  "regenerate_story",
  "regenerate_characters",
  "regenerate_locations",
  "regenerate_style",
  "generate_script",
  "generate_storyboard",
  "generate_storyboard_episode",
  "generate_prompt",
] as const;

/**
 * POST /api/projects/[id]/tasks
 *
 * 通用任务创建 API（非 initialize_assets 类型）
 *
 * Body: { taskType: "regenerate_characters", payload: { customPrompt: "..." } }
 * Response: { taskId: "xxx", status: "pending" }
 *
 * 逻辑与 initialize/route.ts 的 POST 一致：
 * 1. 验证用户 + 项目归属
 * 2. INSERT project_tasks（task_type + payload）
 * 3. 唯一索引冲突 → 409 返回现有 taskId
 * 4. fire-and-forget task-runner
 * 5. 返回 taskId
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. 验证用户 + 项目归属
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 2. 解析 body
  const body = await request.json().catch(() => ({}));
  const { taskType, payload } = body as {
    taskType?: string;
    payload?: Record<string, unknown>;
  };

  if (!taskType || !ALLOWED_TASK_TYPES.includes(taskType as (typeof ALLOWED_TASK_TYPES)[number])) {
    return NextResponse.json({ error: `无效的任务类型: ${taskType}` }, { status: 400 });
  }

  // 3. INSERT project_tasks（唯一索引防重复）
  const { data: task, error: insertError } = await supabase
    .from("project_tasks")
    .insert({
      project_id: id,
      user_id: user.id,
      task_type: taskType,
      payload: payload || {},
      status: "pending",
      progress: {},
    })
    .select("id")
    .single();

  // 唯一索引冲突 → 查现有活跃任务返回
  if (insertError && insertError.code === "23505") {
    const { data: existing } = await supabase
      .from("project_tasks")
      .select("id, status, progress, task_type")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json(
      {
        taskId: existing?.id || null,
        status: existing?.status || "pending",
        progress: existing?.progress || {},
        taskType: existing?.task_type || null,
        error: "已有任务在执行中",
      },
      { status: 409 }
    );
  }

  if (insertError || !task) {
    return NextResponse.json(
      { error: `创建任务失败: ${insertError?.message || "unknown"}` },
      { status: 500 }
    );
  }

  // 4. best effort fire-and-forget 触发 runner
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${process.env.PORT || 8888}`;

  void fetch(`${baseUrl}/api/internal/task-runner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-runner-key": process.env.RUNNER_SECRET!,
    },
    body: JSON.stringify({ taskId: task.id }),
  }).catch(() => {});

  // 5. 返回 taskId
  return NextResponse.json(
    { taskId: task.id, status: "pending" },
    { status: 201 }
  );
}
