import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * POST /api/projects/[id]/initialize
 *
 * 职责：只创建任务，不执行 AI
 * 1. 验证用户 + 项目归属
 * 2. INSERT project_tasks (status='pending')
 * 3. fire-and-forget 触发 task-runner
 * 4. 返回 { taskId } + 201
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. 验证用户 + 项目归属
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, asset_status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 2. 解析 body
  const body = await request.json().catch(() => ({}));

  // reset：标记活跃任务为 failed
  if (body.action === "reset") {
    await supabase
      .from("project_tasks")
      .update({
        status: "failed",
        error: { reason: "user_reset" },
        completed_at: new Date().toISOString(),
      })
      .eq("project_id", id)
      .in("status", ["pending", "running"]);

    await supabase
      .from("projects")
      .update({ asset_status: "failed" })
      .eq("id", id);

    return NextResponse.json({ data: { message: "已重置" } });
  }

  // 3. INSERT project_tasks（唯一索引防重复）
  const { data: task, error: insertError } = await supabase
    .from("project_tasks")
    .insert({
      project_id: id,
      user_id: user.id,
      task_type: "initialize_assets",
      payload: {},
      status: "pending",
      progress: {
        story: "pending",
        characters: "pending",
        locations: "pending",
        style: "pending",
      },
    })
    .select("id")
    .single();

  // 唯一索引冲突 → 查现有活跃任务返回
  if (insertError && insertError.code === "23505") {
    const { data: existing } = await supabase
      .from("project_tasks")
      .select("id, status, progress")
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

  // 4. 更新 projects.asset_status 缓存
  await supabase
    .from("projects")
    .update({ asset_status: "initializing" })
    .eq("id", id);

  // 5. best effort fire-and-forget 触发 runner
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

  // 6. 返回 taskId
  return NextResponse.json(
    { taskId: task.id, status: "pending" },
    { status: 201 }
  );
}

/**
 * GET /api/projects/[id]/initialize
 *
 * 查询当前活跃任务（pending / running）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 查活跃任务
  const { data: task } = await supabase
    .from("project_tasks")
    .select("id, status, progress, error, task_type")
    .eq("project_id", id)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!task) {
    // 无活跃任务，返回 asset_status 让前端判断
    const { data: project } = await supabase
      .from("projects")
      .select("asset_status, asset_progress, asset_error")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({
      taskId: null,
      assetStatus: project?.asset_status || "draft",
      assetProgress: project?.asset_progress || {},
      assetError: project?.asset_error || {},
    });
  }

  return NextResponse.json({
    taskId: task.id,
    status: task.status,
    progress: task.progress || {},
    error: task.error || {},
  });
}
