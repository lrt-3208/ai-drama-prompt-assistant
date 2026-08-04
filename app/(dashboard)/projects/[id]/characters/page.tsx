import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { CharacterList } from "@/components/project/character-list";

export default async function CharactersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: characters } = await supabase
    .from("characters")
    .select("*")
    .eq("project_id", id)
    .order("sort_order", { ascending: true });

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
    <div className="max-w-4xl">
      <CharacterList projectId={id} initial={characters ?? []} activeTask={activeTask as never} />
    </div>
  );
}
