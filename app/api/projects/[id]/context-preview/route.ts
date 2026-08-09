import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { buildContextPreview, buildSceneContextPreview, buildStoryboardContextPreview } from "@/lib/prompt-engine/context-preview";

/**
 * GET /api/projects/[id]/context-preview?shotId=xxx&platform=jimeng&language=zh
 * GET /api/projects/[id]/context-preview?sceneId=xxx&platform=jimeng&language=zh
 * GET /api/projects/[id]/context-preview?sceneId=xxx&mode=storyboard
 *
 * 返回 AI 生成时收到的完整上下文文本（System Message + User Message），用于调试预览
 * mode=storyboard 时返回故事板生成的上下文（不需要 platform/language）
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

  // 2. 验证项目归属
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 3. 解析查询参数
  const url = new URL(_request.url);
  const shotId = url.searchParams.get("shotId");
  const sceneId = url.searchParams.get("sceneId");
  const platform = url.searchParams.get("platform") || "jimeng";
  const language = url.searchParams.get("language") || "zh";
  const mode = url.searchParams.get("mode");

  if (!shotId && !sceneId) {
    return NextResponse.json(
      { error: "需要 shotId 或 sceneId 参数" },
      { status: 400 }
    );
  }

  try {
    if (shotId) {
      const result = await buildContextPreview(shotId, platform, language);
      return NextResponse.json(result);
    } else if (sceneId && mode === "storyboard") {
      const result = await buildStoryboardContextPreview(sceneId);
      return NextResponse.json(result);
    } else if (sceneId) {
      const result = await buildSceneContextPreview(sceneId, platform, language);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "获取上下文预览失败" },
      { status: 500 }
    );
  }
}
