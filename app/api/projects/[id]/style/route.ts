import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { data, error } = await supabase
    .from("visual_styles")
    .select("*")
    .eq("project_id", id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? null });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  if (!body.name?.trim()) return NextResponse.json({ error: "风格名称不能为空" }, { status: 400 });
  if (!body.fixed_prompt?.trim()) return NextResponse.json({ error: "固定 Prompt 不能为空" }, { status: 400 });

  const { data, error } = await supabase
    .from("visual_styles")
    .upsert({
      project_id: id,
      name: body.name.trim(),
      camera_style: body.camera_style?.trim() || null,
      color: body.color?.trim() || null,
      lighting: body.lighting?.trim() || null,
      cinematography: body.cinematography?.trim() || null,
      fixed_prompt: body.fixed_prompt.trim(),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 同步更新 projects.visual_style_id
  await supabase
    .from("projects")
    .update({ visual_style_id: data.id })
    .eq("id", id);

  return NextResponse.json({ data });
}
