"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

interface Project {
  id: string;
  name: string;
  synopsis: string | null;
  genre: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface GenConfig {
  character_count: { min: number; max: number };
  location_count: { min: number; max: number };
  episode_count: { min: number; max: number };
  scenes_per_episode: { min: number; max: number };
  shots_per_scene: { min: number; max: number };
}

const DEFAULT_GEN_CONFIG: GenConfig = {
  character_count: { min: 3, max: 8 },
  location_count: { min: 3, max: 8 },
  episode_count: { min: 3, max: 10 },
  scenes_per_episode: { min: 2, max: 6 },
  shots_per_scene: { min: 2, max: 6 },
};

const CONFIG_LABELS: { key: keyof GenConfig; label: string }[] = [
  { key: "character_count", label: "角色数量" },
  { key: "location_count", label: "场景数量" },
  { key: "episode_count", label: "剧本集数" },
  { key: "scenes_per_episode", label: "每集场景数" },
  { key: "shots_per_scene", label: "每场景镜头数" },
];

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  draft: { label: "草稿", variant: "secondary" },
  scripting: { label: "剧本中", variant: "outline" },
  asset_building: { label: "资产构建", variant: "outline" },
  storyboarding: { label: "分镜中", variant: "outline" },
  prompting: { label: "Prompt 中", variant: "outline" },
  completed: { label: "已完成", variant: "default" },
};

export function ProjectList({ initialProjects }: { initialProjects: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [genre, setGenre] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [genConfig, setGenConfig] = useState<GenConfig>(DEFAULT_GEN_CONFIG);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("项目名称不能为空");
      return;
    }
    setLoading(true);

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, synopsis, genre, generation_config: genConfig }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error || "创建失败");
      return;
    }

    toast.success("创建成功");
    setOpen(false);
    setName("");
    setSynopsis("");
    setGenre("");
    setShowAdvanced(false);
    setGenConfig(DEFAULT_GEN_CONFIG);
    router.push(`/projects/${data.data.id}`);
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此项目？删除后不可恢复。")) return;

    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error || "删除失败");
      return;
    }

    toast.success("已删除");
    setProjects(projects.filter((p) => p.id !== id));
  };

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">还没有项目，创建一个开始吧</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className={buttonVariants()}>
            新建项目
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
            </DialogHeader>
            <ProjectForm
              name={name} setName={setName}
              synopsis={synopsis} setSynopsis={setSynopsis}
              genre={genre} setGenre={setGenre}
              showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
              genConfig={genConfig} setGenConfig={setGenConfig}
              loading={loading}
              onSubmit={handleCreate}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">我的项目</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className={buttonVariants()}>
            新建项目
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
            </DialogHeader>
            <ProjectForm
              name={name} setName={setName}
              synopsis={synopsis} setSynopsis={setSynopsis}
              genre={genre} setGenre={setGenre}
              showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
              genConfig={genConfig} setGenConfig={setGenConfig}
              loading={loading}
              onSubmit={handleCreate}
            />
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => {
          const status = statusMap[project.status] ?? { label: project.status, variant: "secondary" as const };
          return (
            <Card
              key={project.id}
              className="cursor-pointer transition-colors hover:bg-accent/50"
              onClick={() => router.push(`/projects/${project.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{project.name}</CardTitle>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {project.synopsis && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                    {project.synopsis}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  {project.genre && <span className="text-xs text-muted-foreground">{project.genre}</span>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(project.id);
                    }}
                  >
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ProjectForm({
  name, setName, synopsis, setSynopsis, genre, setGenre,
  showAdvanced, setShowAdvanced, genConfig, setGenConfig,
  loading, onSubmit,
}: {
  name: string;
  setName: (v: string) => void;
  synopsis: string;
  setSynopsis: (v: string) => void;
  genre: string;
  setGenre: (v: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  genConfig: GenConfig;
  setGenConfig: (v: GenConfig) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">项目名称</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：重生复仇" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="synopsis">故事简介</Label>
        <Textarea id="synopsis" value={synopsis} onChange={(e) => setSynopsis(e.target.value)} placeholder="一句话描述你的故事" rows={3} className="max-h-32 resize-none" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="genre">类型</Label>
        <Input id="genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="如：都市/悬疑/古风" />
      </div>

      {/* 高级配置 */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        高级配置
      </button>
      {showAdvanced && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          {CONFIG_LABELS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap w-20">{label}</Label>
              <Input
                type="number"
                min={0}
                value={genConfig[key].min}
                onChange={(e) => setGenConfig({ ...genConfig, [key]: { ...genConfig[key], min: Number(e.target.value) } })}
                className="w-16"
              />
              <span className="text-xs text-muted-foreground">~</span>
              <Input
                type="number"
                min={0}
                value={genConfig[key].max}
                onChange={(e) => setGenConfig({ ...genConfig, [key]: { ...genConfig[key], max: Number(e.target.value) } })}
                className="w-16"
              />
            </div>
          ))}
        </div>
      )}

      <Button type="submit" disabled={loading}>
        {loading ? "创建中..." : "创建"}
      </Button>
    </form>
  );
}
