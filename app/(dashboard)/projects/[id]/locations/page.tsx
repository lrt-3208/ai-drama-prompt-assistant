import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { LocationList } from "@/components/project/location-list";

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: locations } = await supabase
    .from("locations")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

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
      <LocationList projectId={id} initial={locations ?? []} activeTask={activeTask as never} />
    </div>
  );
}
