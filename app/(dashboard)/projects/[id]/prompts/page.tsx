import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { PromptWorkbench } from "@/components/project/prompt-workbench";

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 查询分镜数据（episodes → scenes → shots）
  const { data: episodes } = await supabase
    .from("episodes")
    .select("id, episode_number, title, summary, scenes(id, scene_number, location_name, time, shots(id, shot_number, description))")
    .eq("project_id", id)
    .order("episode_number")
    .order("scene_number", { referencedTable: "scenes", ascending: true })
    .order("shot_number", { referencedTable: "scenes.shots", ascending: true });

  // 查询所有 prompts（含 versions + source_prompt_id）
  const { data: prompts } = await supabase
    .from("prompts")
    .select("id, shot_id, prompt_type, platform, language, source_prompt_id, prompt_versions(id, content, version_number, is_current, source, ai_model)")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .order("version_number", { referencedTable: "prompt_versions", ascending: false });

  // 查询所有活跃的 generate_prompt 任务（支持并发）
  const { data: activePromptTasks } = await supabase
    .from("project_tasks")
    .select("id, status, payload, task_type")
    .eq("project_id", id)
    .in("status", ["pending", "running"])
    .eq("task_type", "generate_prompt")
    .order("created_at", { ascending: false });

  return (
    <PromptWorkbench
      projectId={id}
      episodes={episodes as never}
      prompts={prompts as never}
      activePromptTasks={(activePromptTasks || []) as never}
    />
  );
}
