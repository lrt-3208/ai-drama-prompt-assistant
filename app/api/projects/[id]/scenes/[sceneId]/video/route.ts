import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  updateVideo,
  deleteVideo,
  checkVideoStale,
  type VideoSnapshot,
} from "@/lib/models/scenes";

/**
 * PATCH /api/projects/[id]/scenes/[sceneId]/video
 *
 * 回传 / 更新成片链接
 * 接收 video_url + video_provider + video_duration
 * 自动构建 video_snapshot（三层依赖版本号）写入 scenes 表
 */
export async function PATCH(
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

  // 2. 解析 body
  const body = await request.json().catch(() => ({}));
  const { video_url, video_provider, video_duration } = body as {
    video_url?: string;
    video_provider?: string;
    video_duration?: number | null;
  };

  if (!video_url || !video_provider) {
    return NextResponse.json(
      { error: "请提供 video_url 和 video_provider" },
      { status: 400 }
    );
  }

  // 3. 回传成片（自动构建 video_snapshot）
  try {
    const result = await updateVideo(
      sceneId,
      id,
      { video_url, video_provider, video_duration: video_duration ?? null },
      { supabase }
    );

    return NextResponse.json({ data: result });
  } catch (e) {
    console.error("[video] update failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "回传失败" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects/[id]/scenes/[sceneId]/video
 *
 * 查询成片信息 + 失效判定
 * 返回 video_* 字段 + is_stale + stale_reason
 */
export async function GET(
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

  // 2. 查询成片信息
  const { data: scene } = await supabase
    .from("scenes")
    .select(
      "video_url, video_provider, video_duration, video_created_at, video_snapshot"
    )
    .eq("id", sceneId)
    .maybeSingle();

  if (!scene) {
    return NextResponse.json({ error: "场景不存在" }, { status: 404 });
  }

  // 3. 失效判定
  const videoSnapshot = (scene as unknown as { video_snapshot: VideoSnapshot | null })
    .video_snapshot;
  const { isStale, reason } = await checkVideoStale(sceneId, id, videoSnapshot, {
    supabase,
  });

  return NextResponse.json({
    data: {
      ...scene,
      is_stale: isStale,
      stale_reason: reason,
    },
  });
}

/**
 * DELETE /api/projects/[id]/scenes/[sceneId]/video
 *
 * 删除成片链接
 */
export async function DELETE(
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

  // 2. 删除成片信息
  try {
    await deleteVideo(sceneId, { supabase });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[video] delete failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 }
    );
  }
}
