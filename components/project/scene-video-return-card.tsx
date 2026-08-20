"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const VIDEO_PROVIDERS = [
  { value: "kling", label: "Kling" },
  { value: "jimeng", label: "即梦" },
  { value: "runway", label: "Runway" },
  { value: "other", label: "其他" },
] as const;

interface SceneVideoReturnCardProps {
  sceneId: string;
  projectId: string;
  /** 是否已有 Scene Video Prompt（控制回传区可见性） */
  hasVideoPrompt: boolean;
}

interface VideoState {
  video_url: string | null;
  video_provider: string | null;
  video_duration: number | null;
  video_created_at: string | null;
  is_stale: boolean;
  stale_reason: string | null;
}

export function SceneVideoReturnCard({
  sceneId,
  projectId,
  hasVideoPrompt,
}: SceneVideoReturnCardProps) {
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [loading, setLoading] = useState(hasVideoPrompt);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState("kling");
  const [duration, setDuration] = useState("");

  // 拉取成片状态（事件处理器调用，非 render 期间）
  const refetchVideo = async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/video`
      );
      if (!res.ok) return;
      const json = await res.json();
      setVideoState(json.data ?? null);
    } catch {
      // 静默失败
    }
  };

  useEffect(() => {
    if (!hasVideoPrompt) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/scenes/${sceneId}/video`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const json = await res.json();
        setVideoState(json.data ?? null);
      } catch {
        // 静默失败
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [hasVideoPrompt, sceneId, projectId]);

  const handleSubmit = async () => {
    if (!url.trim()) {
      toast.error("请输入成片链接");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/video`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video_url: url.trim(),
            video_provider: provider,
            video_duration: duration ? parseInt(duration, 10) : null,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "回传失败");
      }
      toast.success("成片链接已回传");
      setEditing(false);
      setUrl("");
      setDuration("");
      refetchVideo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "回传失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/scenes/${sceneId}/video`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("删除失败");
      toast.success("已删除成片链接");
      setVideoState(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 没有 Scene Video Prompt 时不显示
  if (!hasVideoPrompt) return null;

  // 加载中
  if (loading) {
    return (
      <Card className="border-l-4 border-l-green-500/40 mt-2">
        <CardContent className="pt-3 pb-3">
          <p className="text-xs text-muted-foreground">成片回传加载中...</p>
        </CardContent>
      </Card>
    );
  }

  const hasVideo = !!videoState?.video_url;
  const isStale = videoState?.is_stale;

  // 编辑模式（未回传或点击更换）
  if (editing || !hasVideo) {
    return (
      <Card className="border-l-4 border-l-green-500/40 mt-2">
        <CardContent className="pt-3 pb-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">🎬 成片回传</Badge>
            <span className="text-xs text-muted-foreground">
              {hasVideo ? "更换成片链接" : "回传出片链接，完成流水线闭环"}
            </span>
          </div>
          <div className="flex gap-2 items-start">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 text-sm"
            />
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {VIDEO_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="时长（秒，可选）"
              type="number"
              className="w-40 text-sm"
            />
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "提交中..." : "确认回传"}
            </Button>
            {hasVideo && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setUrl("");
                }}
                disabled={submitting}
              >
                取消
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 已回传（正常或失效态）
  const providerLabel =
    VIDEO_PROVIDERS.find((p) => p.value === videoState?.video_provider)
      ?.label || videoState?.video_provider || "未知";

  return (
    <Card
      className={`border-l-4 mt-2 ${
        isStale
          ? "border-l-amber-500 border-2 border-amber-500/30"
          : "border-l-green-500"
      }`}
    >
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className={
                isStale
                  ? "bg-amber-500/15 text-amber-600"
                  : "bg-green-500/15 text-green-600"
              }
            >
              🎬 成片{isStale ? "（已失效）" : "已回传"}
            </Badge>
            <Badge variant="outline">{providerLabel}</Badge>
            {videoState.video_duration && (
              <span className="text-xs text-muted-foreground">
                {videoState.video_duration}s
              </span>
            )}
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => {
                setUrl(videoState.video_url || "");
                setProvider(videoState.video_provider || "kling");
                setDuration(
                  videoState.video_duration
                    ? String(videoState.video_duration)
                    : ""
                );
                setEditing(true);
              }}
              disabled={submitting}
            >
              ✎ 更换
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7 text-destructive"
              onClick={handleDelete}
              disabled={submitting}
            >
              ✕ 删除
            </Button>
          </div>
        </div>

        {/* 成片链接 */}
        <div className="flex items-center gap-2">
          {isStale ? (
            <span className="text-sm text-amber-600 line-through truncate">
              {videoState.video_url}
            </span>
          ) : (
            <a
              href={videoState.video_url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline truncate"
            >
              {videoState.video_url}
            </a>
          )}
        </div>

        {/* 失效原因 */}
        {isStale && videoState.stale_reason && (
          <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-700 dark:text-amber-400">
            ⚠ {videoState.stale_reason}，建议更换新成片
          </div>
        )}

        {/* 回传时间 */}
        {videoState.video_created_at && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            回传于{" "}
            {new Date(videoState.video_created_at).toLocaleString("zh-CN")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
