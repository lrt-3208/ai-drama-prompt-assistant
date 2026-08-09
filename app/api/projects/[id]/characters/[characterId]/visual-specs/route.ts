import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { generateVisualSpecs, getVisualSpecs } from "@/lib/ai-actions/visual-specs";

// GET: 查询角色视觉规范
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id, characterId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const specs = await getVisualSpecs(characterId, { supabase });
    return NextResponse.json({ specs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 }
    );
  }
}

// POST: AI 生成角色视觉规范
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id, characterId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const specs = await generateVisualSpecs(characterId, user.id, { supabase });
    return NextResponse.json({ specs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成失败" },
      { status: 500 }
    );
  }
}
