import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import * as Episodes from "@/lib/models/episodes";
import type { PlotOutline, ShotOutline } from "@/lib/models/episodes";

/**
 * PATCH /api/projects/[id]/episodes/[episodeId]
 *
 * 手动编辑剧集内容（剧情大纲 / 分镜大纲 / 标题 / 摘要）
 *
 * Body: {
 *   title?: string,
 *   summary?: string,
 *   plot_outline?: PlotOutline,   // 变更后 plot_version +1
 *   shot_outline?: ShotOutline,   // 变更后 outline_version +1
 * }
 *
 * 版本号自增规则与 AI 生成一致，确保下游「上游脏」判定生效。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. 验证用户 + 项目归属
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 2. 验证 episode 归属
  const { data: episode } = await supabase
    .from("episodes")
    .select("id, project_id")
    .eq("id", episodeId)
    .eq("project_id", id)
    .maybeSingle();

  if (!episode) {
    return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
  }

  // 3. 解析 body
  const body = await request.json().catch(() => ({}));
  const { title, summary, plot_outline, shot_outline } = body as {
    title?: string;
    summary?: string;
    plot_outline?: PlotOutline;
    shot_outline?: ShotOutline;
  };

  let result: Episodes.EpisodeRow | null = null;

  try {
    // 3a. 剧情大纲变更 → plot_version +1（可同时更新 title）
    if (plot_outline) {
      result = await Episodes.updatePlot(
        episodeId,
        {
          plot_outline,
          title: title !== undefined ? title : undefined,
          change_summary: "手动编辑",
        },
        { supabase }
      );
    }

    // 3b. 分镜大纲变更 → outline_version +1
    if (shot_outline) {
      result = await Episodes.updateShotOutline(
        episodeId,
        {
          shot_outline,
          change_summary: "手动编辑",
        },
        { supabase }
      );
    }

    // 3c. 仅更新 title / summary（不涉及版本号变更）
    if (!plot_outline && !shot_outline && (title !== undefined || summary !== undefined)) {
      const updateData: Record<string, unknown> = {};
      if (title !== undefined) updateData.title = title.trim() || null;
      if (summary !== undefined) updateData.summary = summary.trim() || null;

      const { data: updated, error } = await supabase
        .from("episodes")
        .update(updateData)
        .eq("id", episodeId)
        .select(Episodes.EPISODE_COLUMNS)
        .single();

      if (error) throw new Error(`更新剧集信息失败: ${error.message}`);
      result = updated as unknown as Episodes.EpisodeRow;
    }

    if (!result) {
      return NextResponse.json({ error: "没有需要更新的字段" }, { status: 400 });
    }

    return NextResponse.json({ data: result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新剧集失败" },
      { status: 500 }
    );
  }
}
