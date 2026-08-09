import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * GET /api/user/ai-models
 *
 * 列出用户所有 AI 模型（可按 modality 筛选）
 * Query: ?modality=text|image|video
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const modality = request.nextUrl.searchParams.get("modality");

  let query = supabase
    .from("user_ai_models")
    .select(
      "id, name, provider, model, modality, api_base, api_key, temperature, max_tokens, is_default, is_active, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("modality", { ascending: true })
    .order("created_at", { ascending: true });

  if (modality && ["text", "image", "video"].includes(modality)) {
    query = query.eq("modality", modality);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 对 api_key 做脱敏处理（只显示前 4 位 + 末 4 位）
  const masked = (data || []).map((item) => ({
    ...item,
    api_key: item.api_key
      ? item.api_key.length > 12
        ? `${item.api_key.slice(0, 4)}...${item.api_key.slice(-4)}`
        : "****"
      : null,
  }));

  return NextResponse.json({ data: masked });
}

/**
 * POST /api/user/ai-models
 *
 * 新增 AI 模型
 * Body: { name, provider, model, modality, api_base, api_key, temperature, max_tokens, is_default }
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    name,
    provider,
    model,
    modality = "text",
    api_base,
    api_key,
    temperature = 0.3,
    max_tokens = null,
    is_default = false,
  } = body as {
    name?: string;
    provider?: string;
    model?: string;
    modality?: string;
    api_base?: string;
    api_key?: string;
    temperature?: number;
    max_tokens?: number | null;
    is_default?: boolean;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: "模型名称不能为空" }, { status: 400 });
  }
  if (!model?.trim()) {
    return NextResponse.json({ error: "模型标识不能为空" }, { status: 400 });
  }
  if (!["text", "image", "video"].includes(modality)) {
    return NextResponse.json(
      { error: "modality 必须是 text / image / video" },
      { status: 400 }
    );
  }

  // 如果设为默认，先清除该 modality 的其他默认
  if (is_default) {
    await supabase
      .from("user_ai_models")
      .update({ is_default: false })
      .eq("user_id", user.id)
      .eq("modality", modality)
      .eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("user_ai_models")
    .insert({
      user_id: user.id,
      name: name.trim(),
      provider: provider?.trim() || "qwen",
      model: model.trim(),
      modality,
      api_base: api_base?.trim() || null,
      api_key: api_key?.trim() || null,
      temperature,
      max_tokens,
      is_default,
      is_active: true,
    })
    .select("id, name, provider, model, modality, is_default, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "模型名称已存在，请使用不同的名称" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
