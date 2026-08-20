import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getNodeDef } from "@/lib/ai/node-registry";
import { buildNodeVariables } from "@/lib/ai/node-template-loader";
import { renderTemplate } from "@/lib/ai/template-renderer";

/**
 * POST /api/prompt-templates/preview
 *
 * 服务端组装变量 + 渲染模板，返回最终 system prompt 全文。
 * Body: { node_key, system_rule, project_id, episode_number? }
 * → { text, unresolved }
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { node_key, system_rule, project_id, episode_number } = body as {
    node_key?: string;
    system_rule?: string;
    project_id?: string;
    episode_number?: number;
  };

  const def = node_key ? getNodeDef(node_key) : undefined;
  if (!def) {
    return NextResponse.json({ error: "node_key 无效" }, { status: 400 });
  }
  if (!system_rule?.trim()) {
    return NextResponse.json({ error: "模板内容不能为空" }, { status: 400 });
  }
  if (!project_id) {
    return NextResponse.json({ error: "缺少 project_id（预览需要项目上下文组装变量）" }, { status: 400 });
  }

  // 项目必须属于本人（预览会读取项目名/创意等元信息）
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", project_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const { variables } = await buildNodeVariables(supabase, project_id, {
    episodeNumber: typeof episode_number === "number" ? episode_number : undefined,
  });
  const { text, unresolved } = renderTemplate(system_rule, variables);

  return NextResponse.json({ data: { text, unresolved } });
}
