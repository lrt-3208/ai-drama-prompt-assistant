import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id, characterId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) updateData.name = body.name.trim();
  if (body.role !== undefined) updateData.role = body.role?.trim() || null;
  if (body.age !== undefined) updateData.age = body.age || null;
  if (body.gender !== undefined) updateData.gender = body.gender || null;
  if (body.appearance !== undefined) updateData.appearance = body.appearance?.trim() || null;
  if (body.personality !== undefined) updateData.personality = body.personality?.trim() || null;
  if (body.background !== undefined) updateData.background = body.background?.trim() || null;
  if (body.clothing !== undefined) updateData.clothing = body.clothing?.trim() || null;
  if (body.fixed_prompt !== undefined) updateData.fixed_prompt = body.fixed_prompt.trim();

  const { data, error } = await supabase
    .from("characters")
    .update(updateData)
    .eq("id", characterId)
    .eq("project_id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id, characterId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { error } = await supabase
    .from("characters")
    .delete()
    .eq("id", characterId)
    .eq("project_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
