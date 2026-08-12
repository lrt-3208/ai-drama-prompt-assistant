import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";
import * as Storyboards from "@/lib/models/storyboards";
import { createTosClient, getTOSBucket } from "@/lib/tos/client";
import { getPublicUrl } from "@/lib/tos/public-url";
import { randomUUID } from "crypto";

export const maxDuration = 60;

/**
 * POST /api/projects/[id]/storyboards/[sceneId]/image
 *
 * 触发故事板图片生成
 *
 * 请求体: { screenshot: string (base64 PNG) }
 * 流程:
 *   1. 验证用户登录 + 项目归属
 *   2. 验证 storyboard 存在且 document 不为空
 *   3. 将 base64 截图上传到 TOS 临时路径
 *   4. 创建 project_task (task_type='generate_storyboard_image')
 *   5. 返回 { taskId } 供前端轮询
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id, sceneId } = await params;
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

  // 2. 验证 storyboard 存在且 document 不为空
  const storyboard = await Storyboards.getByScene(sceneId, { supabase });
  if (!storyboard || !storyboard.document) {
    return NextResponse.json(
      { error: "Storyboard 文档不存在或未生成，请先生成 Storyboard 文档" },
      { status: 400 }
    );
  }

  // 3. 解析请求体 — 获取 base64 截图
  const body = await request.json().catch(() => ({}));
  const { screenshot } = body as { screenshot?: string };

  if (!screenshot || !screenshot.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "缺少有效的截图数据（base64 PNG）" },
      { status: 400 }
    );
  }

  // 4. 将 base64 截图上传到 TOS 临时路径
  const base64Match = screenshot.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!base64Match) {
    return NextResponse.json(
      { error: "截图 base64 格式无效" },
      { status: 400 }
    );
  }

  const ext = base64Match[1] === "jpeg" ? "jpg" : base64Match[1];
  const screenshotBuffer = Buffer.from(base64Match[2], "base64");
  const screenshotTosKey = `temp/storyboard-screenshots/${randomUUID().replace(/-/g, "").slice(0, 12)}.${ext}`;

  try {
    const tosClient = createTosClient();
    const bucket = getTOSBucket();
    await tosClient.putObject({
      bucket,
      key: screenshotTosKey,
      body: screenshotBuffer,
      contentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "截图上传 TOS 失败", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }

  // 5. 创建 project_task
  const { data: task, error: insertError } = await supabase
    .from("project_tasks")
    .insert({
      project_id: id,
      user_id: user.id,
      task_type: "generate_storyboard_image",
      payload: {
        sceneId,
        screenshotTosKey,
      },
      status: "pending",
      progress: {},
    })
    .select("id")
    .single();

  // 唯一索引冲突 → 已有任务在执行
  if (insertError && insertError.code === "23505") {
    return NextResponse.json(
      { error: "该场景的故事板图片正在生成中，请等待完成" },
      { status: 409 }
    );
  }

  if (insertError || !task) {
    return NextResponse.json(
      { error: `创建任务失败: ${insertError?.message || "unknown"}` },
      { status: 500 }
    );
  }

  // 6. after() 直接执行任务
  const taskId = task.id;
  after(async () => {
    try {
      const serviceClient = createServiceClient();
      await executeGenerationTask(serviceClient, taskId);
    } catch (e) {
      console.error("[storyboard-image] after() execution failed:", e);
    }
  });

  // 7. 返回 taskId
  return NextResponse.json(
    { taskId: task.id, status: "pending" },
    { status: 201 }
  );
}

/**
 * GET /api/projects/[id]/storyboards/[sceneId]/image
 *
 * 获取当前故事板图片信息
 *
 * 返回: { assetId, imageUrl, optimizationPrompt }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id, sceneId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 验证用户
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 验证项目归属
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 查询 storyboard 图片信息
  const storyboard = await Storyboards.getByScene(sceneId, { supabase });
  if (!storyboard) {
    return NextResponse.json(
      { error: "Storyboard 不存在" },
      { status: 404 }
    );
  }

  // 如果有 asset_id，查询 asset 的 tos_key
  let imageUrl: string | null = null;
  if (storyboard.storyboard_image_asset_id) {
    const { data: asset } = await supabase
      .from("assets")
      .select("tos_key")
      .eq("id", storyboard.storyboard_image_asset_id)
      .maybeSingle();

    if (asset?.tos_key) {
      imageUrl = getPublicUrl(asset.tos_key);
    }
  }

  return NextResponse.json({
    assetId: storyboard.storyboard_image_asset_id,
    imageUrl,
    optimizationPrompt: storyboard.optimized_image_prompt,
  });
}
