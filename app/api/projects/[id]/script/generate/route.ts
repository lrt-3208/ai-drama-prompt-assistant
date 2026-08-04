import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { generateScript } from "@/lib/ai-actions/script";

export async function POST(
  _request: NextRequest,
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

  try {
    const script = await generateScript(id, user.id);
    return NextResponse.json({ data: script });
  } catch (err) {
    const message = err instanceof Error ? err.message : "剧本生成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
