import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

// 轮询端点必须总是返回最新数据，禁止缓存
export const dynamic = "force-dynamic";

/**
 * GET /api/projects/[id]/tasks/active
 *
 * 批量查询项目所有活跃任务（pending / running）
 * 单次请求替代 N 次单独轮询，减少网络开销
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. 验证用户
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 2. 批量查询所有活跃任务
  const { data: tasks } = await supabase
    .from("project_tasks")
    .select("id, status, progress, error, task_type, payload")
    .eq("project_id", id)
    .in("status", ["pending", "running", "success", "partial", "failed"])
    .order("created_at", { ascending: false })
    .limit(50);

  // 3. 分离活跃和已完成
  const active = (tasks || []).filter((t) =>
    ["pending", "running"].includes(t.status)
  );
  const completed = (tasks || []).filter((t) =>
    ["success", "partial", "failed"].includes(t.status)
  );

  return NextResponse.json({
    active,
    // 只返回刚完成的（活跃列表里没有但状态是终态的）
    // 前端用这个列表来触发 onDone 回调
    recentlyCompleted: completed.slice(0, 20),
  });
}
