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

  // script 和 activeTask 独立查询，并行执行
  const [scriptRes, activeTaskRes] = await Promise.all([
    supabase
      .from("scripts")
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
  ]);
  const script = scriptRes.data;

  return <ScriptView projectId={id} initial={script as never} activeTask={activeTaskRes.data as never} />;
}
