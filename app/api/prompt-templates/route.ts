import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getNodeDef } from "@/lib/ai/node-registry";

/**
 * LLM 节点提示词模板 API（用户级配置，走 cookie client + RLS）
 *
 * GET    ?node_key=&mode=              → 生效模板 + 变量清单（配置界面维度视图）
 * GET    ?node_key=&mode=&history=1    → 该维度版本历史
 * PUT    { node_key, serialization_mode, system_rule } → 保存为新版本
 * DELETE ?node_key=&mode=              → 删除该维度全部用户版本（恢复系统默认）
 * POST   { node_key, version_id }      → 回滚到指定版本
 *
 * mode 参数：generic=通用（serialization_mode NULL）/ continuous / episodic / mixed
 */

const MODE_VALUES = ["generic", "continuous", "episodic", "mixed"] as const;

/** mode 参数 → serialization_mode 列值（generic → NULL） */
function modeToColumn(mode: string): string | null {
  return mode === "generic" ? null : mode;
}

/** 解析并校验 node_key + mode；非 modeAware 节点强制 generic */
function parseNodeAndMode(rawNodeKey: string | null, rawMode: string | null) {
  if (!rawNodeKey) {
    return { error: "缺少 node_key 参数" as const };
  }
  const def = getNodeDef(rawNodeKey);
  if (!def) {
    return { error: `未知的 LLM 节点: ${rawNodeKey}` as const };
  }
  const mode = def.modeAware ? (rawMode ?? "generic") : "generic";
  if (!MODE_VALUES.includes(mode as (typeof MODE_VALUES)[number])) {
    return { error: "mode 必须是 generic / continuous / episodic / mixed" as const };
  }
  return { def, mode };
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const parsed = parseNodeAndMode(params.get("node_key"), params.get("mode"));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { def, mode } = parsed;
  const columnMode = modeToColumn(mode);

  // 版本历史：该用户该维度全部版本（含已过期）
  if (params.get("history") === "1") {
    let query = supabase
      .from("llm_prompt_templates")
      .select("id, version_number, is_current, created_at, system_rule")
      .eq("node_key", def.key)
      .eq("user_id", user.id)
      .order("version_number", { ascending: false });
    query = columnMode === null
      ? query.is("serialization_mode", null)
      : query.eq("serialization_mode", columnMode);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // 摘要：首行 60 字，避免列表 payload 过大
    const history = (data || []).map((row) => ({
      id: row.id,
      version_number: row.version_number,
      is_current: row.is_current,
      created_at: row.created_at,
      summary: (row.system_rule || "").slice(0, 60),
    }));
    return NextResponse.json({ data: history });
  }

  // 生效模板（配置界面维度视图：用户精确 → 用户通用 → 系统精确 → 系统通用 → 内置）
  const { data: rows, error } = await supabase
    .from("llm_prompt_templates")
    .select("user_id, serialization_mode, system_rule, version_number, source")
    .eq("node_key", def.key)
    .eq("is_current", true)
    .or(`user_id.eq.${user.id},user_id.is.null`);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sameMode = (row: { serialization_mode: string | null }, m: string | null) =>
    m === null ? row.serialization_mode === null : row.serialization_mode === m;

  const userRows = (rows || []).filter((r) => r.user_id === user.id);
  const systemRows = (rows || []).filter((r) => r.user_id === null);

  const userExact = userRows.find((r) => sameMode(r, columnMode));
  const userGeneric = userRows.find((r) => r.serialization_mode === null);
  const systemExact = systemRows.find((r) => sameMode(r, columnMode));
  const systemGeneric = systemRows.find((r) => r.serialization_mode === null);

  const chosen = userExact ?? userGeneric ?? systemExact ?? systemGeneric ?? null;

  // 查看「模式专属」Tab 但生效行来自通用维度（用户或系统的通用行）→ 标记继承
  const inherited =
    mode !== "generic" && !userExact && !systemExact &&
    (!!userGeneric || !!systemGeneric);

  const result = {
    system_rule: chosen?.system_rule ?? def.defaultSystemRule,
    source: chosen ? (chosen.user_id === user.id ? "user" : "system") : "builtin",
    version_number: chosen?.version_number ?? null,
    variables: def.variables,
    is_user_overridden: chosen ? chosen.user_id === user.id : false,
    inherited,
  };

  return NextResponse.json({ data: result });
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { node_key, serialization_mode, system_rule } = body as {
    node_key?: string;
    serialization_mode?: string | null;
    system_rule?: string;
  };

  const def = node_key ? getNodeDef(node_key) : undefined;
  if (!def) {
    return NextResponse.json({ error: "node_key 无效" }, { status: 400 });
  }
  if (!system_rule?.trim()) {
    return NextResponse.json({ error: "模板内容不能为空" }, { status: 400 });
  }

  // 非 modeAware 节点强制通用维度；modeAware 校验合法值（缺省=通用）
  let columnMode: string | null = null;
  if (def.modeAware && serialization_mode) {
    if (!["continuous", "episodic", "mixed"].includes(serialization_mode)) {
      return NextResponse.json({ error: "serialization_mode 必须是 continuous / episodic / mixed" }, { status: 400 });
    }
    columnMode = serialization_mode;
  }

  // 该维度当前最大版本号
  let maxQuery = supabase
    .from("llm_prompt_templates")
    .select("version_number")
    .eq("node_key", def.key)
    .eq("user_id", user.id)
    .order("version_number", { ascending: false })
    .limit(1);
  maxQuery = columnMode === null
    ? maxQuery.is("serialization_mode", null)
    : maxQuery.eq("serialization_mode", columnMode);
  const { data: maxRows } = await maxQuery;
  const nextVersion = (maxRows?.[0]?.version_number ?? 0) + 1;

  // 旧 is_current 置 false → 插入新版本（RLS 限定本人）
  let clearQuery = supabase
    .from("llm_prompt_templates")
    .update({ is_current: false })
    .eq("node_key", def.key)
    .eq("user_id", user.id)
    .eq("is_current", true);
  clearQuery = columnMode === null
    ? clearQuery.is("serialization_mode", null)
    : clearQuery.eq("serialization_mode", columnMode);
  const { error: clearError } = await clearQuery;
  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  const { data: inserted, error } = await supabase
    .from("llm_prompt_templates")
    .insert({
      user_id: user.id,
      node_key: def.key,
      serialization_mode: columnMode,
      system_rule: system_rule.trim(),
      version_number: nextVersion,
      is_current: true,
      source: "user",
    })
    .select("id, version_number, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: inserted }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const parsed = parseNodeAndMode(params.get("node_key"), params.get("mode"));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { def, mode } = parsed;
  const columnMode = modeToColumn(mode);

  let query = supabase
    .from("llm_prompt_templates")
    .delete()
    .eq("node_key", def.key)
    .eq("user_id", user.id);
  query = columnMode === null
    ? query.is("serialization_mode", null)
    : query.eq("serialization_mode", columnMode);

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { ok: true } });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { node_key, version_id } = body as { node_key?: string; version_id?: string };

  const def = node_key ? getNodeDef(node_key) : undefined;
  if (!def) {
    return NextResponse.json({ error: "node_key 无效" }, { status: 400 });
  }
  if (!version_id) {
    return NextResponse.json({ error: "缺少 version_id" }, { status: 400 });
  }

  // 目标版本必须属于本人 + 该节点
  const { data: target } = await supabase
    .from("llm_prompt_templates")
    .select("id, serialization_mode")
    .eq("id", version_id)
    .eq("user_id", user.id)
    .eq("node_key", def.key)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "目标版本不存在" }, { status: 404 });
  }

  // 同维度其余 is_current 置 false → 目标行设为当前版本
  let clearQuery = supabase
    .from("llm_prompt_templates")
    .update({ is_current: false })
    .eq("node_key", def.key)
    .eq("user_id", user.id)
    .eq("is_current", true);
  clearQuery = target.serialization_mode === null
    ? clearQuery.is("serialization_mode", null)
    : clearQuery.eq("serialization_mode", target.serialization_mode);
  const { error: clearError } = await clearQuery;
  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  const { error } = await supabase
    .from("llm_prompt_templates")
    .update({ is_current: true })
    .eq("id", version_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { ok: true, version_id } });
}
