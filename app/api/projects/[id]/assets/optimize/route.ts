import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { optimizeAsset, type OptimizeEntityType } from "@/lib/ai-actions/asset-optimize";

const ENTITY_TYPES: OptimizeEntityType[] = ["character", "location", "visual_style"];

/**
 * POST: AI 优化资产（角色 / 场景 / 风格）
 * body: { entity_type, entity_id, prompt }
 * 对照原型 03-assets.html「✨ AI 优化 → 生成优化版本」
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const { entity_type, entity_id, prompt } = body;

  if (!ENTITY_TYPES.includes(entity_type)) {
    return NextResponse.json({ error: "无效的资产类型" }, { status: 400 });
  }
  if (!entity_id || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "缺少资产 ID 或优化提示词" }, { status: 400 });
  }

  // 项目归属校验
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  // 锁定检查：已生成任何一集剧情后，资产文字配置锁定（保证视觉一致性）
  const { count } = await supabase
    .from("episodes")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id)
    .not("plot_outline", "is", null);
  if ((count || 0) > 0) {
    return NextResponse.json(
      { error: "资产已锁定（已生成剧情），无法 AI 优化。如需修改请到设置页清空剧情" },
      { status: 403 }
    );
  }

  try {
    const result = await optimizeAsset(
      { entityType: entity_type, entityId: entity_id, userId: user.id, prompt },
      { supabase }
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "优化失败" },
      { status: 500 }
    );
  }
}
