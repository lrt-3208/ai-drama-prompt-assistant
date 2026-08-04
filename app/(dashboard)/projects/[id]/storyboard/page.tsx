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

  // 嵌套查询 episodes → scenes → shots（含 episode status）
  const { data: episodes } = await supabase
    .from("episodes")
    .select("id, episode_number, title, summary, status, scenes(id, scene_number, location_name, time, weather, shots(id, shot_number, description, action, emotion, environment, cinematography, dialogue))")
    .eq("project_id", id)
    .order("episode_number")
    .order("scene_number", { referencedTable: "scenes", ascending: true })
    .order("shot_number", { referencedTable: "scenes.shots", ascending: true });

  // 查询每集的 Prompt 状态（用于显示 [图✓] [视✓]）
  const { data: prompts } = await supabase
    .from("prompts")
    .select("shot_id, prompt_type")
    .eq("project_id", id);

  // 按集数查询 episode_outline（用于显示可生成集）
  const { data: script } = await supabase
    .from("scripts")
    .select("episode_outline")
    .eq("project_id", id)
    .single();

  // 查询活跃任务（pending / running）
  const { data: activeTask } = await supabase
    .from("project_tasks")
    .select("id, status, progress, task_type")
    .eq("project_id", id)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <StoryboardView
      projectId={id}
      initial={episodes as never}
      prompts={prompts as never}
      episodeOutline={script?.episode_outline as never}
      activeTask={activeTask as never}
    />
  );
}
