"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
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
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">项目设置</h2>
        <p className="text-sm text-muted-foreground">
          生成数量配置、AI 模型与项目信息管理。
        </p>
      </div>

      {/* 生成数量配置 */}
      <div className="mb-3 bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <span className="w-1 h-4 bg-primary rounded" />
          <span className="text-sm font-medium text-foreground">生成数量配置</span>
        </div>
        <div className="p-5">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
            配置 AI 生成角色、场景、剧本、分镜时的数量范围。修改后对新生成的内容生效，已有数据不受影响。
          </p>
          <div className="space-y-2.5">
            {CONFIG_LABELS.map(({ key, label, desc }) => (
              <div
                key={key}
                className="bg-background/60 border border-border rounded-lg px-3.5 py-2.5 flex items-center gap-3"
              >
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="text-[11px] text-foreground font-medium">{label}</span>
                  <span className="text-[10px] text-muted-foreground">{desc}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    value={genConfig[key].min}
                    onChange={(e) => setGenConfig({ ...genConfig, [key]: { ...genConfig[key], min: Number(e.target.value) } })}
                    className="w-16 h-8 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">~</span>
                  <Input
                    type="number"
                    min={0}
                    value={genConfig[key].max}
                    onChange={(e) => setGenConfig({ ...genConfig, [key]: { ...genConfig[key], max: Number(e.target.value) } })}
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition disabled:opacity-40"
          >
            {saving ? "保存中..." : "保存配置"}
          </button>
        </div>
      </div>

      {/* AI 模型配置 */}
      <div className="mb-3 bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <span className="w-1 h-4 bg-primary rounded" />
          <span className="text-sm font-medium text-foreground">AI 模型配置</span>
        </div>
        <div className="p-5">
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
            AI 模型配置已迁移到全局管理页面。每个用户可为文本、图片、视频生成分别配置独立的默认模型。
          </p>
          <Link
            href="/settings/ai-models"
            className="inline-block px-3 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition"
          >
            前往 AI 模型管理 →
          </Link>
        </div>
      </div>

      {/* 项目信息 */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <span className="w-1 h-4 bg-primary rounded" />
          <span className="text-sm font-medium text-foreground">项目信息</span>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">项目 ID</span>
            <code className="px-1.5 py-0.5 rounded bg-surface2 border border-border font-mono text-[10px] text-muted-foreground">
              {projectId}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
