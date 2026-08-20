import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { StoryForm } from "@/components/project/story-form";

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3 个独立查询并行执行
  const [projectRes, activeTaskRes, storyRes] = await Promise.all([
    supabase
      .from("projects")
      .select("asset_status")
      .eq("id", id)
      .single(),
    supabase
      .from("project_tasks")
      .select("id, status, progress, error, task_type")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("stories")
      .select("*")
      .eq("project_id", id)
      .single(),
  ]);
  const project = projectRes.data;
  const activeTask = activeTaskRes.data;
  const story = storyRes.data;

  const assetStatus = project?.asset_status ?? "draft";
  const isInitTask = activeTask?.task_type === "initialize_assets";
  const hasActiveTask = !!activeTask;

  // 渲染逻辑（初始化已拆到独立页 /init/[id]）：
  // 1. 有活跃的 initialize_assets 任务 → 跳转 /init/[id]（loading 轮询）
  // 2. 未初始化完成且无活跃任务（draft/partial/failed/initializing）→ 跳转 /init/[id]
  // 3. initialized 或仅有非 init 活跃任务（regenerate_story 等）→ 正常展示 StoryForm
  if (isInitTask || (!hasActiveTask && assetStatus !== "initialized")) {
    redirect(`/init/${id}`);
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">故事</h2>
        <p className="text-sm text-muted-foreground">
          AI 已理解你的故事创意，以下是基于你的输入自动生成的分析结果。
        </p>
      </div>
      <StoryForm
        projectId={id}
        initialStory={story as never}
        activeTask={activeTask as never}
      />
    </div>
  );
}
