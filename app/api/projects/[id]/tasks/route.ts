import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";
import { hasDefaultAIModel } from "@/lib/ai/config";

// Vercel: after() 执行 AI 任务需要足够的运行时间
export const maxDuration = 60;

// 允许的 task_type 列表
const ALLOWED_TASK_TYPES = [
  "regenerate_story",
  "regenerate_characters",
  "regenerate_locations",
  "regenerate_style",
  "generate_script",
  "generate_episode_plot",
  "generate_episode_outline",
  "generate_storyboard",
  "generate_storyboard_episode",
  "generate_prompt",
  "generate_storyboard_asset",
  "generate_scene_video_prompt",
  "generate_storyboard_image",
  "run_impact",
  "run_regen",
  "evaluate_prompt",
] as const;

/**
 * POST /api/projects/[id]/tasks
 *
 * 通用任务创建 API（非 initialize_assets 类型）
 *
 * Body: { taskType: "regenerate_characters", payload: { customPrompt: "..." } }
 * Response: { taskId: "xxx", status: "pending" }
 *
 * 1. 验证用户 + 项目归属
 * 2. 验证 AI 配置（api_key + api_base 必须已配置）
 * 3. INSERT project_tasks
 * 4. after() 直接执行任务（Vercel 不支持 fire-and-forget fetch）
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

  // 2. 验证 AI 配置（检查用户默认模型）
  const hasModel = await hasDefaultAIModel(supabase, user.id, "text");
  if (!hasModel) {
    return NextResponse.json(
      { error: "AI 模型未配置，请先到「AI 模型管理」页面配置默认文本模型" },
      { status: 400 }
    );
  }

  // 3. 解析 body
  const body = await request.json().catch(() => ({}));
  const { taskType, payload } = body as {
    taskType?: string;
    payload?: Record<string, unknown>;
  };

  if (!taskType || !ALLOWED_TASK_TYPES.includes(taskType as (typeof ALLOWED_TASK_TYPES)[number])) {
    return NextResponse.json({ error: `无效的任务类型: ${taskType}` }, { status: 400 });
  }

  // 4. INSERT project_tasks
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
    // 场景级任务：按 sceneId 精确查找冲突任务
    // 集级任务：按 episodeNumber 精确查找冲突任务
    const sceneId = (payload as Record<string, unknown>)?.sceneId as string | undefined;
    const episodeNumber = (payload as Record<string, unknown>)?.episodeNumber as string | undefined;
    let query = supabase
      .from("project_tasks")
      .select("id, status, progress, task_type, payload")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false });

    if (sceneId) {
      query = query.eq("payload->>sceneId", sceneId);
    } else if (episodeNumber) {
      query = query.eq("payload->>episodeNumber", episodeNumber);
    }

    const { data: existing } = await query.limit(1).maybeSingle();

    // 根据冲突类型生成更具体的错误信息
    let errorMessage = "已有任务在执行中";
    if (existing?.task_type === "generate_storyboard_asset") {
      errorMessage = sceneId
        ? "该场景的 Storyboard 正在生成中，请等待完成"
        : "Storyboard 正在生成中，请等待完成";
    } else if (existing?.task_type === "generate_scene_video_prompt") {
      errorMessage = sceneId
        ? "该场景的视频 Prompt 正在生成中，请等待完成"
        : "场景视频 Prompt 正在生成中，请等待完成";
    } else if (existing?.task_type === "generate_storyboard_image") {
      errorMessage = sceneId
        ? "该场景的故事板图片正在生成中，请等待完成"
        : "故事板图片正在生成中，请等待完成";
    } else if (existing?.task_type === "generate_storyboard_episode") {
      errorMessage = `第 ${episodeNumber} 集分镜正在生成中，请等待完成`;
    }

    return NextResponse.json(
      {
        taskId: existing?.id || null,
        status: existing?.status || "pending",
        progress: existing?.progress || {},
        taskType: existing?.task_type || null,
        error: errorMessage,
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

  // 5. after() 直接执行任务（Vercel 不支持 fire-and-forget fetch）
  // 任务在响应发送后执行，maxDuration 内完成
  const taskId = task.id;
  after(async () => {
    try {
      const serviceClient = createServiceClient();
      await executeGenerationTask(serviceClient, taskId);
    } catch (e) {
      console.error("[tasks] after() execution failed:", e);
    }
  });

  // 6. 返回 taskId
  return NextResponse.json(
    { taskId: task.id, status: "pending" },
    { status: 201 }
  );
}
