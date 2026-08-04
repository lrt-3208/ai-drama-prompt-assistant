import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { StoryForm } from "@/components/project/story-form";
import { InitProject } from "@/components/project/init-project";

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 查询 project（含 asset_status + asset_error + asset_progress）
  const { data: project } = await supabase
    .from("projects")
    .select("asset_status, asset_error, asset_progress")
    .eq("id", id)
    .single();

  // 查询最新活跃任务（pending / running）
  const { data: activeTask } = await supabase
    .from("project_tasks")
    .select("id, status, progress, error, task_type")
    .eq("project_id", id)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 查询 story
  const { data: story } = await supabase
    .from("stories")
    .select("*")
    .eq("project_id", id)
    .single();

  const assetStatus = project?.asset_status ?? "draft";

  // 渲染逻辑：
  // 1. 有活跃的 initialize_assets 任务 → InitProject loading 模式
  // 2. 有活跃的非 init 任务（regenerate_story 等）→ StoryForm + 轮询
  // 3. asset_status === 'initialized'（无活跃任务）→ 正常展示 StoryForm
  // 4. asset_status === 'draft'（无活跃任务）→ auto 模式
  // 5. asset_status === 'partial'/'failed'/'initializing'（无活跃任务）→ retry 模式

  const isInitTask = activeTask?.task_type === "initialize_assets";
  const hasActiveTask = !!activeTask;
  const isInitialized = assetStatus === "initialized";
  const needsAutoInit = assetStatus === "draft" && !hasActiveTask;
  const needsRetry =
    ["partial", "failed", "initializing"].includes(assetStatus) && !hasActiveTask;
  const showStoryForm = !isInitTask && (isInitialized || (hasActiveTask && !isInitTask));

  return (
    <div className="max-w-3xl">
      {/* 有活跃的 initialize_assets 任务 → loading 模式 */}
      {isInitTask && (
        <InitProject
          projectId={id}
          mode="loading"
          taskId={activeTask!.id}
          taskStatus={activeTask!.status}
          assetProgress={activeTask!.progress as Record<string, string> | null}
          assetError={activeTask!.error as Record<string, string> | null}
        />
      )}

      {/* draft + 无活跃任务 → auto 模式 */}
      {needsAutoInit && (
        <InitProject projectId={id} mode="auto" />
      )}

      {/* failed/partial/initializing + 无活跃任务 → retry 模式 */}
      {needsRetry && (
        <InitProject
          projectId={id}
          mode="retry"
          assetError={project?.asset_error as Record<string, string> | null}
          assetProgress={project?.asset_progress as Record<string, string> | null}
          assetStatus={assetStatus}
        />
      )}

      {/* initialized 或有非 init 活跃任务 → 正常展示 */}
      {showStoryForm && (
        <>
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-1">故事</h2>
            <p className="text-sm text-muted-foreground">
              AI 已理解你的故事创意，以下是基于你的输入自动生成的分析结果。
            </p>
          </div>
          <StoryForm
            projectId={id}
            initialStory={story as never}
            activeTask={!isInitTask ? (activeTask as never) : null}
          />
        </>
      )}
    </div>
  );
}
