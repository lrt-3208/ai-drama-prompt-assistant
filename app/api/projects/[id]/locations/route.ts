import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { generateStableKey } from "@/lib/ai-actions/assets";

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
    .from("locations")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

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
  if (!body.name?.trim()) return NextResponse.json({ error: "场景名称不能为空" }, { status: 400 });
  if (!body.fixed_prompt?.trim()) return NextResponse.json({ error: "固定 Prompt 不能为空" }, { status: 400 });

  const { data, error } = await supabase
    .from("locations")
    .insert({
      project_id: id,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      environment: body.environment?.trim() || null,
      time: body.time?.trim() || null,
      weather: body.weather?.trim() || null,
      color_style: body.color_style?.trim() || null,
      fixed_prompt: body.fixed_prompt.trim(),
      stable_key: generateStableKey("location"),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
