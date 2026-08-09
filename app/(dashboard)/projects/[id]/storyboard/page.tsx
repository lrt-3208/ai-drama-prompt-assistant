import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { StoryboardView } from "@/components/project/storyboard-view";

export default async function StoryboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 4 个独立查询并行执行
  const [episodesRes, promptsRes, scriptRes, activeTasksRes] = await Promise.all([
    supabase
      .from("episodes")
      .select("id, episode_number, title, summary, status, scenes(id, scene_number, location_name, time, weather, shots(id, shot_number, description, action, emotion, environment, cinematography, dialogue))")
      .eq("project_id", id)
      .order("episode_number")
      .order("scene_number", { referencedTable: "scenes", ascending: true })
      .order("shot_number", { referencedTable: "scenes.shots", ascending: true }),
    supabase
      .from("prompts")
      .select("shot_id, prompt_type")
      .eq("project_id", id),
    supabase
      .from("scripts")
      .select("episode_outline")
      .eq("project_id", id)
      .single(),
    supabase
      .from("project_tasks")
      .select("id, status, progress, task_type, payload")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .in("task_type", ["generate_storyboard", "generate_storyboard_episode"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // 将 DB 任务映射为 StoryboardTask 格式
  const initialTasks = (activeTasksRes.data || []).map((t) => ({
    id: t.id,
    status: t.status,
    task_type: t.task_type,
    payload: {
      episodeNumber: (t.payload as Record<string, unknown>)?.episodeNumber as number | undefined,
    },
  }));

  return (
    <StoryboardView
      projectId={id}
      initial={episodesRes.data as never}
      prompts={promptsRes.data as never}
      episodeOutline={scriptRes.data?.episode_outline as never}
      initialTasks={initialTasks}
    />
  );
}
