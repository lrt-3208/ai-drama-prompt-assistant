import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { hasDefaultAIModel } from "@/lib/ai/config";

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, synopsis, genre, status, cover_url, created_at, updated_at")
    .neq("status", "deleted")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json();
  const { name, synopsis, genre, serialization_mode, generation_config } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
  }

  // 连载模式校验（continuous 连续剧情 / episodic 单元剧 / mixed 混合）
  const SERIALIZATION_MODES = ["continuous", "episodic", "mixed"] as const;
  const mode = SERIALIZATION_MODES.includes(serialization_mode)
    ? serialization_mode
    : "continuous";

  // 检查用户是否已配置默认文本模型
  const hasModel = await hasDefaultAIModel(supabase, user.id, "text");
  if (!hasModel) {
    return NextResponse.json(
      { error: "请先到「AI 模型管理」页面配置默认文本模型" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: name.trim(),
      synopsis: synopsis?.trim() || null,
      genre: genre?.trim() || null,
      status: "draft",
      asset_status: "draft",
      serialization_mode: mode,
      generation_config: generation_config || null,
    })
    .select("id, name, synopsis, genre, status, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 同步创建 story 记录
  const { error: storyError } = await supabase
    .from("stories")
    .insert({
      project_id: data.id,
      raw_input: synopsis?.trim() || name.trim(),
      input_mode: "story",
      genre: genre?.trim() || null,
    });

  if (storyError) {
    console.error("[Projects API] 创建 story 记录失败:", storyError.message);
  }

  return NextResponse.json({ data });
}
