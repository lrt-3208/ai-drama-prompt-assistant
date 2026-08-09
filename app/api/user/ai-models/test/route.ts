import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getProvider } from "@/lib/ai/adapters/factory";
import type { AIRequestConfig } from "@/lib/ai/types";

/**
 * POST /api/user/ai-models/test
 *
 * 测试 AI 模型配置连通性
 *
 * 两种模式：
 * 1. 传 model_id → 从数据库读取真实 api_key 等配置（用于模型卡片测试）
 * 2. 传 provider/model/api_base/api_key → 直接用表单数据测试（用于表单内测试）
 *
 * Response: { ok: true, model: "...", latency: 1234 }
 *          / { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { model_id, provider, model, api_base, api_key } = body as {
    model_id?: string;
    provider?: string;
    model?: string;
    api_base?: string;
    api_key?: string;
  };

  let configProvider = provider || "qwen";
  let configModel = model || "qwen3.7-max";
  let configApiBase = api_base?.trim() || "";
  let configApiKey = api_key?.trim() || "";

  // 模式 1：通过 model_id 从数据库读取真实配置
  if (model_id) {
    const { data: modelRecord } = await supabase
      .from("user_ai_models")
      .select("provider, model, api_base, api_key")
      .eq("id", model_id)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!modelRecord) {
      return NextResponse.json(
        { ok: false, error: "模型不存在" },
        { status: 404 }
      );
    }

    configProvider = modelRecord.provider || "qwen";
    configModel = modelRecord.model;
    configApiBase = modelRecord.api_base || "";
    configApiKey = modelRecord.api_key || "";
  }

  if (!configApiBase || !configApiKey) {
    return NextResponse.json(
      { ok: false, error: "API 地址和 API Key 不能为空" },
      { status: 400 }
    );
  }

  const config: AIRequestConfig = {
    provider: configProvider,
    model: configModel,
    apiBase: configApiBase,
    apiKey: configApiKey,
    maxTokens: 64,
    temperature: 0.1,
  };

  try {
    const providerInstance = getProvider(config.provider);
    const startTime = Date.now();

    await providerInstance.chat(
      [
        { role: "system", content: "You are a test assistant. Reply with: ok" },
        { role: "user", content: "test" },
      ],
      config
    );

    const latency = Date.now() - startTime;

    return NextResponse.json({
      ok: true,
      model: config.model,
      latency,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ ok: false, error: message });
  }
}
