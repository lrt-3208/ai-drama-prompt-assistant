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
    .from("characters")
    .select("*")
    .eq("project_id", id)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
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
  if (!body.name?.trim()) return NextResponse.json({ error: "角色名称不能为空" }, { status: 400 });
  if (!body.fixed_prompt?.trim()) return NextResponse.json({ error: "固定 Prompt 不能为空" }, { status: 400 });

  const { data, error } = await supabase
    .from("characters")
    .insert({
      project_id: id,
      name: body.name.trim(),
      role: body.role?.trim() || null,
      age: body.age || null,
      gender: body.gender || null,
      appearance: body.appearance?.trim() || null,
      personality: body.personality?.trim() || null,
      background: body.background?.trim() || null,
      clothing: body.clothing?.trim() || null,
      fixed_prompt: body.fixed_prompt.trim(),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
