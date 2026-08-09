import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { exportPrompts, type ExportFormat } from "@/lib/prompt-engine/prompt-exporter";

export async function GET(
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

  // 权限检查
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const format = (request.nextUrl.searchParams.get("format") as ExportFormat) || "markdown";

  try {
    const content = await exportPrompts(id, format, { supabase });
    return NextResponse.json({ content, format });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "导出失败" },
      { status: 500 }
    );
  }
}
