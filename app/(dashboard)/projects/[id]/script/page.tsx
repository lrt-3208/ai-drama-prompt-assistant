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

  const { data: script } = await supabase
    .from("scripts")
    .select("*")
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

  return <ScriptView projectId={id} initial={script as never} activeTask={activeTask as never} />;
}
