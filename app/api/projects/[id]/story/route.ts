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
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("stories")
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
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json();
  const { raw_input, input_mode, theme, genre, core_conflict, target_emotion } = body;

  if (!raw_input?.trim()) {
    return NextResponse.json({ error: "故事内容不能为空" }, { status: 400 });
  }

  // Upsert: 如果已有 story 则更新，否则创建
  const { data, error } = await supabase
    .from("stories")
    .upsert({
      project_id: id,
      raw_input: raw_input.trim(),
      input_mode: input_mode || "story",
      theme: theme?.trim() || null,
      genre: genre?.trim() || null,
      core_conflict: core_conflict?.trim() || null,
      target_emotion: target_emotion?.trim() || null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
