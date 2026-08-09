import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * PUT /api/user/ai-models/[modelId]/default
 *
 * 将指定模型设为该 modality 的默认模型
 * 同时取消该 modality 下其他模型的 is_default
 */
export async function PUT(
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

  // 验证模型归属 + 获取 modality
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

  // 1. 取消该 modality 下所有 is_default
  const { error: clearError } = await supabase
    .from("user_ai_models")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("modality", existing.modality)
    .eq("is_default", true);

  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  // 2. 设置目标模型为默认
  const { error: setError } = await supabase
    .from("user_ai_models")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", modelId)
    .eq("user_id", user.id);

  if (setError) {
    return NextResponse.json({ error: setError.message }, { status: 500 });
  }

  return NextResponse.json({
    data: { id: modelId, modality: existing.modality, is_default: true },
  });
}
