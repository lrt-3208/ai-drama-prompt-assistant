import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id, locationId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) updateData.name = body.name.trim();
  if (body.description !== undefined) updateData.description = body.description?.trim() || null;
  if (body.environment !== undefined) updateData.environment = body.environment?.trim() || null;
  if (body.time !== undefined) updateData.time = body.time?.trim() || null;
  if (body.weather !== undefined) updateData.weather = body.weather?.trim() || null;
  if (body.color_style !== undefined) updateData.color_style = body.color_style?.trim() || null;
  if (body.fixed_prompt !== undefined) updateData.fixed_prompt = body.fixed_prompt.trim();

  const { data, error } = await supabase
    .from("locations")
    .update(updateData)
    .eq("id", locationId)
    .eq("project_id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id, locationId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { error } = await supabase
    .from("locations")
    .delete()
    .eq("id", locationId)
    .eq("project_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
