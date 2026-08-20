import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { ScriptView } from "@/components/project/script-view";

export default async function ScriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // script（旧链路项目设定，兼容展示）+ stories（初始化故事创意）+ episodes（逐集剧情/分镜大纲）+ 进行中任务，并行查询
  const [scriptRes, storyRes, episodesRes, activeTasksRes] = await Promise.all([
    supabase
      .from("scripts")
      .select("*")
      .eq("project_id", id)
      .maybeSingle(),
    supabase
      .from("stories")
      .select("raw_input, theme, genre, core_conflict, target_emotion")
      .eq("project_id", id)
      .maybeSingle(),
    supabase
      .from("episodes")
      .select(
        "id, episode_number, title, summary, status, " +
          "plot_outline, plot_version, plot_updated_at, plot_change_summary, " +
          "shot_outline, outline_version, outline_updated_at, outline_change_summary, " +
          "storyboard_version, storyboard_updated_at, " +
          "outline_based_on_plot_version, storyboard_based_on_outline_version, " +
          "scenes(id)"
      )
      .eq("project_id", id)
      .order("episode_number"),
    supabase
      .from("project_tasks")
      .select("id, status, progress, task_type, payload")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <ScriptView
      projectId={id}
      initial={scriptRes.data as never}
      story={storyRes.data as never}
      episodes={episodesRes.data as never}
      activeTasks={(activeTasksRes.data || []) as never}
    />
  );
}
