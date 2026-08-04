"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useTaskPolling, type ActiveTask } from "@/hooks/use-task-polling";

interface ScriptCharacter {
  name: string;
  role: string;
  description: string;
}

interface PlotPoint {
  scene: string;
  description: string;
  emotion: string;
}

interface EpisodeOutlineItem {
  episode: number;
  title: string;
  outline: string;
}

interface ScriptData {
  id?: string;
  synopsis: string | null;
  genre: string | null;
  characters: ScriptCharacter[] | null;
  relationships: string | null;
  worldview: string | null;
  plot_outline: PlotPoint[] | null;
  episode_outline: EpisodeOutlineItem[] | null;
}

export function ScriptView({
  projectId,
  initial,
  activeTask,
}: {
  projectId: string;
  initial: ScriptData | null;
  activeTask?: ActiveTask | null;
}) {
  const router = useRouter();

  const { isGenerating, createTask } = useTaskPolling({
    projectId,
    initialTask: activeTask,
    onDone: (status) => {
      if (status === "success") toast.success("剧本生成成功");
      else toast.error("剧本生成失败");
      router.refresh();
    },
  });

  const handleGenerate = () => {
    toast.info("AI 生成剧本中，通常需要 30-60 秒，请耐心等待...");
    createTask("generate_script");
  };

  if (!initial) {
    return (
      <div className="max-w-5xl">
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-1">剧本</h2>
          <p className="text-sm text-muted-foreground">
            基于故事输入，AI 自动生成结构化剧本（含角色对话、场景描述、情绪节奏）。
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-lg gap-4">
          <p className="text-muted-foreground">尚未生成剧本</p>
          <Button onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? "AI 生成中..." : "生成剧本"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1">剧本</h2>
          <p className="text-sm text-muted-foreground">
            基于故事输入，AI 自动生成结构化剧本。
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={isGenerating} variant="outline">
          {isGenerating ? "生成中..." : "重新生成"}
        </Button>
      </div>

      {initial.synopsis && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">故事梗概</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{initial.synopsis}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        {initial.genre && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">类型</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge>{initial.genre}</Badge>
            </CardContent>
          </Card>
        )}
        {initial.worldview && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">世界观</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{initial.worldview}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {initial.characters && initial.characters.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">角色</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {initial.characters.map((c, i) => (
              <div key={i} className="flex items-start gap-3">
                <Badge variant="secondary">{c.role}</Badge>
                <div>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-muted-foreground ml-2">
                    {c.description}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {initial.relationships && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">角色关系</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{initial.relationships}</p>
          </CardContent>
        </Card>
      )}

      {initial.plot_outline && initial.plot_outline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">剧情大纲</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              共 {initial.plot_outline.length} 个剧情段落，分镜生成时会自动分配到各集中
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {initial.plot_outline.map((p, i) => (
              <div key={i} className="border-l-2 border-primary/30 pl-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">
                    段落 {i + 1}: {p.scene}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {p.emotion}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{p.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {initial.episode_outline && initial.episode_outline.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">分集大纲</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              共 {initial.episode_outline.length} 集，按集生成分镜时只传该集大纲
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {initial.episode_outline.map((ep) => (
              <div key={ep.episode} className="border-l-2 border-primary/30 pl-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge className="text-xs">第 {ep.episode} 集</Badge>
                  <span className="font-medium text-sm">{ep.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{ep.outline}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
