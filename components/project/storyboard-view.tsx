"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useTaskPolling, type ActiveTask } from "@/hooks/use-task-polling";

interface Shot {
  id: string;
  shot_number: number;
  description: string | null;
  action: string | null;
  emotion: string | null;
  environment: string | null;
  cinematography: string | null;
  dialogue: string | null;
}

interface Scene {
  id: string;
  scene_number: number;
  location_name: string | null;
  time: string | null;
  weather: string | null;
  shots: Shot[];
}

interface Episode {
  id: string;
  episode_number: number;
  title: string | null;
  summary: string | null;
  status: string | null;
  scenes: Scene[];
}

interface PromptRef {
  shot_id: string;
  prompt_type: string;
}

interface EpisodeOutlineItem {
  episode: number;
  title: string;
  outline: string;
}

export function StoryboardView({
  projectId,
  initial,
  prompts,
  episodeOutline,
  activeTask,
}: {
  projectId: string;
  initial: Episode[] | null;
  prompts: PromptRef[] | null;
  episodeOutline: EpisodeOutlineItem[] | null;
  activeTask?: ActiveTask | null;
}) {
  const router = useRouter();

  const { isGenerating, createTask } = useTaskPolling({
    projectId,
    initialTask: activeTask,
    onDone: (status) => {
      if (status === "success") toast.success("分镜生成成功");
      else toast.error("分镜生成失败");
      router.refresh();
    },
  });

  // 构建 shot_id → prompt 状态映射
  const promptStatusMap = new Map<string, { image: boolean; video: boolean }>();
  if (prompts) {
    for (const p of prompts) {
      const existing = promptStatusMap.get(p.shot_id) || { image: false, video: false };
      if (p.prompt_type === "image") existing.image = true;
      if (p.prompt_type === "video") existing.video = true;
      promptStatusMap.set(p.shot_id, existing);
    }
  }

  // 生成全量分镜
  const handleGenerateAll = async () => {
    toast.info("AI 全量生成分镜中，通常需要 2-5 分钟，请耐心等待...");
    try {
      await createTask("generate_storyboard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // 按集生成分镜
  const handleGenerateEpisode = async (episodeNumber: number) => {
    toast.info(`AI 生成第 ${episodeNumber} 集分镜中，通常需要 30-60 秒...`);
    try {
      await createTask("generate_storyboard_episode", { episodeNumber });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // 状态徽章
  const statusBadge = (status: string | null) => {
    switch (status) {
      case "generating":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">生成中...</Badge>;
      case "storyboarded":
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">已生成</Badge>;
      case "failed":
        return <Badge variant="destructive">生成失败</Badge>;
      default:
        return <Badge variant="outline">未生成</Badge>;
    }
  };

  // 空状态
  if (!initial || initial.length === 0) {
    const outlineList = episodeOutline || [];
    return (
      <div className="max-w-6xl">
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-1">分镜</h2>
          <p className="text-sm text-muted-foreground">
            将剧本拆解为分镜列表，每个镜头包含画面描述、角色动作、对白与情绪标注。
          </p>
        </div>

        {outlineList.length > 0 ? (
          <div className="flex flex-col gap-3">
            {outlineList.map((ep) => (
              <Card key={ep.episode}>
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge>第 {ep.episode} 集</Badge>
                      <span className="font-medium text-sm">{ep.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{ep.outline}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleGenerateEpisode(ep.episode)}
                    disabled={isGenerating}
                  >
                    {isGenerating ? "生成中..." : "生成分镜"}
                  </Button>
                </CardContent>
              </Card>
            ))}
            <div className="flex justify-end mt-2">
              <Button
                onClick={handleGenerateAll}
                disabled={isGenerating}
                variant="outline"
              >
                {isGenerating ? "全量生成中..." : "全量生成"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-lg gap-4">
            <p className="text-muted-foreground">尚未生成分镜</p>
            <Button onClick={handleGenerateAll} disabled={isGenerating}>
              {isGenerating ? "AI 生成中..." : "生成分镜"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // 计算未生成的集（episode_outline 中有但 episodes 中没有的）
  const generatedEpisodeNumbers = new Set(initial.map((ep) => ep.episode_number));
  const pendingEpisodes = (episodeOutline || []).filter(
    (ep) => !generatedEpisodeNumbers.has(ep.episode)
  );
  const totalEpisodes = (episodeOutline || []).length;

  // 是否有任意集正在生成中（用于禁用全量按钮和其他按钮）
  const hasGenerating = initial.some((ep) => ep.status === "generating");
  const isBusy = isGenerating || hasGenerating;

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1">分镜</h2>
          <p className="text-sm text-muted-foreground">
            将剧本拆解为分镜列表，每个镜头包含画面描述、角色动作、对白与情绪标注。
            {totalEpisodes > 0 && (
              <span className="ml-2">
                共 {totalEpisodes} 集 · 已生成 {initial.length} 集
                {pendingEpisodes.length > 0 && ` · 待生成 ${pendingEpisodes.length} 集`}
              </span>
            )}
          </p>
        </div>
        <Button onClick={handleGenerateAll} disabled={isBusy} variant="outline">
          {isGenerating ? "全量生成中..." : "全量重新生成"}
        </Button>
      </div>

      {initial.map((ep) => (
        <Card key={ep.id} className="mb-6 border-l-4 border-l-primary/40">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge className="text-sm">第 {ep.episode_number} 集</Badge>
                {ep.title && <CardTitle className="text-base">{ep.title}</CardTitle>}
                {statusBadge(ep.status)}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleGenerateEpisode(ep.episode_number)}
                disabled={isBusy}
              >
                {isGenerating || ep.status === "generating"
                  ? "生成中..."
                  : ep.status === "storyboarded"
                  ? "重新生成"
                  : "生成分镜"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {ep.summary && <p className="text-sm text-muted-foreground mb-4">{ep.summary}</p>}

            {ep.scenes?.map((sc) => (
              <div key={sc.id} className="pl-4 border-l-2 border-l-muted mb-5 last:mb-0">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-semibold text-sm bg-muted px-2 py-0.5 rounded">
                    场景 {sc.scene_number}
                  </span>
                  {sc.location_name && (
                    <Badge variant="secondary" className="text-xs">{sc.location_name}</Badge>
                  )}
                  {sc.time && <Badge variant="outline" className="text-xs">{sc.time}</Badge>}
                  {sc.weather && <Badge variant="outline" className="text-xs">{sc.weather}</Badge>}
                </div>

                {sc.shots?.map((sh) => {
                  const ps = promptStatusMap.get(sh.id) || { image: false, video: false };
                  return (
                    <div key={sh.id} className="bg-muted/30 rounded-lg p-3 mb-2 last:mb-0 ml-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-muted-foreground min-w-[3rem]">
                              镜头 {sh.shot_number}
                            </span>
                            {sh.cinematography && (
                              <Badge variant="outline" className="text-xs">{sh.cinematography}</Badge>
                            )}
                            {/* Prompt 状态指示 */}
                            <span className="text-xs">
                              {ps.image ? "🖼 ✓" : "🖼 ✗"}
                            </span>
                            <span className="text-xs">
                              {ps.video ? "🎬 ✓" : "🎬 ✗"}
                            </span>
                          </div>
                          {sh.description && <p className="text-sm font-medium">{sh.description}</p>}
                          {sh.environment && <p className="text-xs text-muted-foreground mt-1">环境: {sh.environment}</p>}
                          {sh.action && <p className="text-xs text-muted-foreground mt-1">动作: {sh.action}</p>}
                          {sh.emotion && <p className="text-xs text-muted-foreground mt-1">情绪: {sh.emotion}</p>}
                          {sh.dialogue && (
                            <p className="text-sm mt-1 italic border-l-2 border-primary/30 pl-2">
                              &ldquo;{sh.dialogue}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* 待生成的集 */}
      {pendingEpisodes.length > 0 && (
        <>
          <div className="mt-6 mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">待生成集</h3>
            <Badge variant="outline" className="text-xs">{pendingEpisodes.length} 集</Badge>
          </div>
          {pendingEpisodes.map((ep) => (
            <Card key={`pending-${ep.episode}`} className="mb-3 border-dashed">
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex-1 mr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline">第 {ep.episode} 集</Badge>
                    <span className="font-medium text-sm">{ep.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{ep.outline}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleGenerateEpisode(ep.episode)}
                  disabled={isBusy}
                >
                  {isGenerating ? "生成中..." : "生成分镜"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
