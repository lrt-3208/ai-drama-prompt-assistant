"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface SettingsViewProps {
  projectId: string;
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

const CONFIG_LABELS: { key: keyof GenConfig; label: string; desc: string }[] = [
  { key: "character_count", label: "角色数量", desc: "AI 生成角色时的数量范围" },
  { key: "location_count", label: "场景数量", desc: "AI 生成场景时的数量范围" },
  { key: "episode_count", label: "剧本集数", desc: "剧本分集大纲的集数范围" },
  { key: "scenes_per_episode", label: "每集场景数", desc: "分镜生成时每集的场景数量范围" },
  { key: "shots_per_scene", label: "每场景镜头数", desc: "每个场景的镜头数量范围" },
];

export function SettingsView({ projectId }: SettingsViewProps) {
  const [genConfig, setGenConfig] = useState<GenConfig>(DEFAULT_GEN_CONFIG);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      const data = await res.json();
      if (res.ok && data.data?.generation_config) {
        const raw = data.data.generation_config;
        setGenConfig({
          character_count: raw.character_count ?? DEFAULT_GEN_CONFIG.character_count,
          location_count: raw.location_count ?? DEFAULT_GEN_CONFIG.location_count,
          episode_count: raw.episode_count ?? DEFAULT_GEN_CONFIG.episode_count,
          scenes_per_episode: raw.scenes_per_episode ?? DEFAULT_GEN_CONFIG.scenes_per_episode,
          shots_per_scene: raw.shots_per_scene ?? DEFAULT_GEN_CONFIG.shots_per_scene,
        });
      }
    })();
  }, [projectId]);

  const handleSave = async () => {
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_config: genConfig }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "保存失败");
      return;
    }
    toast.success("配置已保存，新生成的内容将使用新配置");
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">项目设置</h2>
        <p className="text-sm text-muted-foreground">
          项目基础信息和 AI 模型配置管理。
        </p>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">生成数量配置</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            配置 AI 生成角色、场景、剧本、分镜时的数量范围。修改后对新生成的内容生效，已有数据不受影响。
          </p>
          {CONFIG_LABELS.map(({ key, label, desc }) => (
            <div key={key} className="flex items-center gap-3">
              <div className="flex flex-col gap-0.5 w-28">
                <Label className="text-xs">{label}</Label>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
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
          <Button onClick={handleSave} disabled={saving} size="sm" className="self-start">
            {saving ? "保存中..." : "保存配置"}
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">AI 模型配置</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            AI 模型配置已迁移到全局管理页面。每个用户可为文本、图片、视频生成分别配置独立的默认模型。
          </p>
          <Link href="/settings/ai-models">
            <Button variant="outline" size="sm">
              前往 AI 模型管理
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">项目信息</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            项目 ID: <span className="font-mono text-xs">{projectId}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
