import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * POST /api/projects/[id]/initialize/wakeup
 *
 * 前端恢复入口：发现 pending 任务时调用
 * secret 不出浏览器 — wakeup 在服务端用 RUNNER_SECRET 调 task-runner
 *
 * 架构：
 * Browser（无 secret）
 *   ↓ POST /wakeup
 * wakeup API（验证用户归属）
 *   ↓ server secret
 * task-runner API（验证 secret + 执行 AI）
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
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 2. 查 pending 任务
  const { data: task } = await supabase
    .from("project_tasks")
    .select("id, status")
    .eq("project_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ message: "no pending task" });
  }

  // 3. 服务端用 secret 调 task-runner（secret 不出浏览器）
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

  return NextResponse.json({ taskId: task.id, status: "waking_up" });
}
