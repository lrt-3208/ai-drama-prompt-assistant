import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { StyleForm } from "@/components/project/style-form";

export default async function StylePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3 个独立查询并行执行（含项目级锁定判定：已有剧情则资产锁定）
  const [styleRes, activeTaskRes, plotCountRes] = await Promise.all([
    supabase
      .from("visual_styles")
      .select("*")
      .eq("project_id", id)
      .single(),
    supabase
      .from("project_tasks")
      .select("id, status, progress, task_type")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("episodes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .not("plot_outline", "is", null),
  ]);

  const plotCount = plotCountRes.count ?? 0;

  return (
    <StyleForm
      projectId={id}
      initial={styleRes.data as never}
      activeTask={activeTaskRes.data as never}
      assetLocked={plotCount > 0}
      plotCount={plotCount}
    />
  );
}
