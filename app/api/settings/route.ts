import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * GET /api/settings
 *
 * 读取 ai_config 表全部配置
 */
export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ai_config")
    .select("provider, model, temperature, api_base, api_key")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    provider: data?.provider || null,
    model: data?.model || null,
    temperature: data?.temperature ?? null,
    apiBase: data?.api_base || null,
    apiKey: data?.api_key || null,
  });
}

/**
 * POST /api/settings
 *
 * 更新 ai_config 表配置（provider/model/temperature/api_base/api_key）
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { provider, model, temperature, api_base, api_key } = body as {
    provider?: string;
    model?: string;
    temperature?: number;
    api_base?: string;
    api_key?: string;
  };

  // 构建更新对象（只更新提供的字段）
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (provider !== undefined) update.provider = provider || null;
  if (model !== undefined) update.model = model || null;
  if (temperature !== undefined) update.temperature = temperature;
  if (api_base !== undefined) update.api_base = api_base || null;
  if (api_key !== undefined) update.api_key = api_key || null;

  const { error } = await supabase
    .from("ai_config")
    .update(update)
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "配置已更新" });
}
