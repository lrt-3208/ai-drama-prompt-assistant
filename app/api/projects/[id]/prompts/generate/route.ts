import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { generateImagePrompt, generateVideoPrompt } from "@/lib/prompt-engine/prompt-generator";

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

  const body = await request.json();
  const { shotId, promptType, platform, language } = body;

  if (!shotId || !promptType || !platform) {
    return NextResponse.json(
      { error: "缺少必要参数: shotId, promptType, platform" },
      { status: 400 }
    );
  }

  if (!["image", "video"].includes(promptType)) {
    return NextResponse.json(
      { error: "promptType 必须是 image 或 video" },
      { status: 400 }
    );
  }

  try {
    const result =
      promptType === "image"
        ? await generateImagePrompt(
            shotId,
            id,
            user.id,
            platform,
            (language as "zh" | "en") || "zh"
          )
        : await generateVideoPrompt(
            shotId,
            id,
            user.id,
            platform,
            (language as "zh" | "en") || "zh"
          );
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prompt 生成失败";
    // 视频依赖检查失败返回 400
    const status = message.includes("请先生成") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
