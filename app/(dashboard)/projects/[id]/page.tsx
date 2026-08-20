import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

/**
 * 项目入口：按初始化状态分流
 * - initialized → 项目工作台（剧本 Tab）
 * - 未初始化（draft/partial/failed/initializing）→ 独立初始化页 /init/[id]
 * 认证与项目归属校验由 (dashboard)/layout.tsx 与 projects/[id]/layout.tsx 保证
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: project } = await supabase
    .from("projects")
    .select("asset_status")
    .eq("id", id)
    .neq("status", "deleted")
    .single();

  if (!project) redirect("/dashboard");

  redirect(
    project.asset_status === "initialized"
      ? `/projects/${id}/story`
      : `/init/${id}`
  );
}
