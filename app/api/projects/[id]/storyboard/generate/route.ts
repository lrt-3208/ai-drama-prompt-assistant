import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { generateStoryboard, generateEpisodeStoryboard } from "@/lib/ai-actions/storyboard";

export async function POST(
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

  // 验证项目归属
  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .single();

  if (!project) {
    return NextResponse.json({ error: "项目不存在或无权限" }, { status: 404 });
  }

  // 解析 body（可选 episodeNumber）
  let body: { episodeNumber?: number } = {};
  try {
    body = await request.json();
  } catch {
    // body 为空时使用全量生成
  }

  try {
    if (body.episodeNumber) {
      // 按集生成
      const episode = await generateEpisodeStoryboard(id, body.episodeNumber, user.id);
      return NextResponse.json({ data: episode });
    } else {
      // 全量生成
      const storyboard = await generateStoryboard(id, user.id);
      return NextResponse.json({ data: storyboard });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "分镜生成失败";
    // 并发冲突返回 409
    const status = message.startsWith("409:") ? 409 : 500;
    return NextResponse.json(
      { error: message.replace(/^409:/, "") },
      { status }
    );
  }
}
