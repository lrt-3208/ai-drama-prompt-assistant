import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * PATCH /api/user/ai-models/[modelId]
 *
 * 修改模型配置（部分更新）
 * Body: { name?, provider?, model?, modality?, api_base?, api_key?, temperature?, max_tokens? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 验证模型归属
  const { data: existing } = await supabase
    .from("user_ai_models")
    .select("id, modality")
    .eq("id", modelId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "模型不存在" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    name,
    provider,
    model,
    modality,
    api_base,
    api_key,
    temperature,
    max_tokens,
  } = body as Record<string, unknown>;

  // 构建更新对象（只更新提供的字段）
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (name !== undefined) update.name = String(name).trim();
  if (provider !== undefined) update.provider = String(provider).trim() || "qwen";
  if (model !== undefined) update.model = String(model).trim();
  if (modality !== undefined) {
    if (!["text", "image", "video"].includes(String(modality))) {
      return NextResponse.json(
        { error: "modality 必须是 text / image / video" },
        { status: 400 }
      );
    }
    update.modality = String(modality);
  }
  if (api_base !== undefined) update.api_base = String(api_base).trim() || null;
  // 只在非空时更新 api_key，空值表示用户未重新输入，保留原 key
  if (api_key !== undefined && String(api_key).trim()) {
    update.api_key = String(api_key).trim();
  }
  if (temperature !== undefined) update.temperature = Number(temperature);
  if (max_tokens !== undefined) {
    update.max_tokens = max_tokens === null ? null : Number(max_tokens);
  }

  const { data, error } = await supabase
    .from("user_ai_models")
    .update(update)
    .eq("id", modelId)
    .eq("user_id", user.id)
    .select("id, name, provider, model, modality, is_default, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "模型名称已存在" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/**
 * DELETE /api/user/ai-models/[modelId]
 *
 * 软删除模型（is_active=false）
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 验证模型归属
  const { data: existing } = await supabase
    .from("user_ai_models")
    .select("id, is_default, modality")
    .eq("id", modelId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "模型不存在" }, { status: 404 });
  }

  // 软删除
  const { error } = await supabase
    .from("user_ai_models")
    .update({
      is_active: false,
      is_default: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", modelId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "模型已删除" });
}
