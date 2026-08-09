import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { ProjectTabs } from "@/components/project/project-tabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 使用 getUser() 远程验证用户身份（Supabase 安全推荐）
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, synopsis, genre, status")
    .eq("id", id)
    .neq("status", "deleted")
    .single();

  if (error || !project) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{project.name}</h1>
          {project.synopsis && (
            <p className="text-sm text-muted-foreground">{project.synopsis}</p>
          )}
        </div>
        {project.genre && (
          <span className="text-sm text-muted-foreground px-3 py-1 rounded-full bg-muted">
            {project.genre}
          </span>
        )}
      </div>
      <ProjectTabs projectId={project.id} />
      <div className="mt-2">{children}</div>
    </div>
  );
}
