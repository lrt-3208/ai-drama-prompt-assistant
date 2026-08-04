import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeInitializeTask } from "@/lib/tasks/initialize-assets";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";

// Vercel: after() 执行 AI 任务需要足够的运行时间
export const maxDuration = 60;

/**
 * POST /api/projects/[id]/initialize/wakeup
 *
 * 前端恢复入口：发现 pending 任务时调用
 * 直接在 after() 中执行任务（Vercel 不支持 fire-and-forget fetch）
 *
 * 架构：
 * Browser（无 secret）
 *   ↓ POST /wakeup
 * wakeup API（验证用户归属）
 *   ↓ after() 直接执行（service client）
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
    .select("id, status, task_type")
    .eq("project_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ message: "no pending task" });
  }

  // 3. after() 直接执行任务（根据 task_type dispatch）
  const taskId = task.id;
  const taskType = task.task_type;

  after(async () => {
    try {
      const serviceClient = createServiceClient();
      if (taskType === "initialize_assets") {
        await executeInitializeTask(serviceClient, taskId);
      } else {
        await executeGenerationTask(serviceClient, taskId);
      }
    } catch (e) {
      console.error("[wakeup] after() execution failed:", e);
    }
  });

  return NextResponse.json({ taskId: task.id, status: "waking_up" });
}
