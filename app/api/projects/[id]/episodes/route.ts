import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import * as Episodes from "@/lib/models/episodes";

/**
 * POST /api/projects/[id]/episodes
 *
 * 追加一集（集号自增）
 *
 * Body: { title?: string }
 * Response: { data: EpisodeRow }
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
  const title = body.title?.trim() || undefined;

  // 3. 追加集
  try {
    const episode = await Episodes.appendEpisode(id, title, { supabase });
    return NextResponse.json({ data: episode }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "追加剧集失败" },
      { status: 500 }
    );
  }
}
