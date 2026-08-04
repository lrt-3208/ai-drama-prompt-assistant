import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * GET /api/tasks/[taskId]
 *
 * 轻量查询任务状态（< 50ms）
 * 前端每 3s 轮询
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. 验证用户
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 2. 查任务（RLS 保证只能查自己的）
  const { data: task } = await supabase
    .from("project_tasks")
    .select("id, status, progress, error, result, task_type")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  return NextResponse.json(task);
}
