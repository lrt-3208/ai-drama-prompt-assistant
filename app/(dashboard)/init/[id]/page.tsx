import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { InitPageView } from "@/components/project/init-page-view";

/**
 * 项目初始化页（独立页面，对照原型 02-init.html）
 *
 * 渲染逻辑：
 * 1. 有活跃 initialize_assets 任务 → loading（轮询）
 * 2. asset_status === 'draft'（无活跃任务）→ auto（自动创建任务并轮询）
 * 3. asset_status ∈ partial/failed/initializing（无活跃任务）→ retry（手动重试）
 * 4. asset_status === 'initialized' → done（完成态统计 + 下一步指引）
 */
export default async function InitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [projectRes, taskRes, charCountRes, locCountRes, epCountRes] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, genre, serialization_mode, asset_status, asset_progress, asset_error, generation_config, visual_style:visual_styles!visual_style_id(name)"
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .neq("status", "deleted")
      .single(),
    supabase
      .from("project_tasks")
      .select("id, status, progress, error, task_type")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("characters")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id),
    supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id),
    supabase
      .from("episodes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id),
  ]);

  const project = projectRes.data;
  if (!project) redirect("/dashboard");

  const activeTask = taskRes.data;
  const assetStatus = project.asset_status ?? "draft";

  // 骨架数展示：优先实际已建集数，回退生成配置上限值
  const genConfig = project.generation_config as
    | { episode_count?: { min: number; max: number } }
    | null;
  const skeletonCount =
    epCountRes.count && epCountRes.count > 0
      ? epCountRes.count
      : genConfig?.episode_count?.max ?? 10;

  // mode 判定
  const isInitTask = activeTask?.task_type === "initialize_assets";
  const mode = isInitTask
    ? "loading"
    : assetStatus === "initialized"
    ? "done"
    : assetStatus === "draft"
    ? "auto"
    : "retry";

  return (
    <InitPageView
      projectId={project.id}
      projectName={project.name}
      genre={project.genre}
      serializationMode={project.serialization_mode ?? "continuous"}
      styleName={
        (project.visual_style as { name?: string } | null)?.name ?? null
      }
      mode={mode}
      taskId={isInitTask ? activeTask!.id : null}
      taskStatus={isInitTask ? activeTask!.status : null}
      initialProgress={
        (isInitTask
          ? (activeTask!.progress as Record<string, string> | null)
          : (project.asset_progress as Record<string, string> | null)) ?? {}
      }
      assetError={
        (project.asset_error as Record<string, string> | null) ??
        (isInitTask ? (activeTask!.error as Record<string, string> | null) : null)
      }
      stats={{
        characters: charCountRes.count ?? 0,
        locations: locCountRes.count ?? 0,
        episodes: epCountRes.count ?? 0,
        episodeSkeletons: skeletonCount,
      }}
    />
  );
}
