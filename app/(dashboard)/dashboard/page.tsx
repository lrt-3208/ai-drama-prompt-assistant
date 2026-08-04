import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { ProjectList } from "@/components/project/project-list";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, synopsis, genre, status, created_at, updated_at")
    .neq("status", "deleted")
    .order("updated_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <ProjectList initialProjects={projects ?? []} />
    </div>
  );
}
