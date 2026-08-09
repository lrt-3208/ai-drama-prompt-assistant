import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { StyleForm } from "@/components/project/style-form";

export default async function StylePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 2 个独立查询并行执行
  const [styleRes, activeTaskRes] = await Promise.all([
    supabase
      .from("visual_styles")
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

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">视觉风格</h2>
        <p className="text-sm text-muted-foreground">
          项目级视觉风格，所有镜头的 Prompt 都会引用此固定风格。
        </p>
      </div>
      <StyleForm projectId={id} initial={styleRes.data as never} activeTask={activeTaskRes.data as never} />
    </div>
  );
}
