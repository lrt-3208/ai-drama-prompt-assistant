import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/** 设置指定版本为当前版本 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> }
) {
  const { id, promptId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 验证 prompt 归属（通过 project_id 间接验证）
  const { data: prompt } = await supabase
    .from("prompts")
    .select("id, project_id")
    .eq("id", promptId)
    .eq("project_id", id)
    .single();

  if (!prompt) {
    return NextResponse.json({ error: "Prompt 不存在或无权限" }, { status: 404 });
  }

  const body = await request.json();
  const { versionId } = body;

  if (!versionId) {
    return NextResponse.json({ error: "缺少 versionId" }, { status: 400 });
  }

  // 验证 versionId 属于该 prompt
  const { data: version } = await supabase
    .from("prompt_versions")
    .select("id")
    .eq("id", versionId)
    .eq("prompt_id", promptId)
    .single();

  if (!version) {
    return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  }

  // 取消所有版本的 is_current
  const { error: unmarkError } = await supabase
    .from("prompt_versions")
    .update({ is_current: false })
    .eq("prompt_id", promptId)
    .eq("is_current", true);

  if (unmarkError) {
    return NextResponse.json({ error: unmarkError.message }, { status: 500 });
  }

  // 设置新版本为 current
  const { error: markError } = await supabase
    .from("prompt_versions")
    .update({ is_current: true })
    .eq("id", versionId);

  if (markError) {
    return NextResponse.json({ error: markError.message }, { status: 500 });
  }

  return NextResponse.json({ data: { versionId, is_current: true } });
}
