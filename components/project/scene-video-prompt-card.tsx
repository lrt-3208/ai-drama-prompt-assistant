"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface DependencyImage {
  url: string;
  label: string;
  kind: "character" | "location" | "shot" | "storyboard";
}

// ============================================
// 类型定义
// ============================================

interface SceneVideoPromptVersion {
  id: string;
  content: string;
  version_number: number;
  is_current: boolean;
  negative_prompt: string | null;
  source: string;
  ai_model: string | null;
}

interface SceneVideoPromptData {
  id: string;
  prompt_type: string;
  platform: string | null;
  language: string | null;
  negative_prompt: string | null;
  quality_score: number | null;
  quality_note: string | null;
  is_stale: boolean;
  stale_reason: string | null;
  prompt_versions: SceneVideoPromptVersion[];
}

interface SceneVideoPromptCardProps {
  sceneId: string;
  projectId: string;
  sceneNumber: number;
  locationName: string | null;
  sceneVideoPrompt: SceneVideoPromptData | null;
  storyboardStatus: string | null;
  ready: boolean;
  missingShots: number[];
  isGenerating?: boolean;
  isEvaluating?: boolean;
  onGenerate?: () => void;
  onEvaluate?: () => void;
  onSwitchVersion?: (versionId: string) => void;
  dependencyImages?: DependencyImage[];
  onPreviewContext?: () => void;
}

// ============================================
// 组件
// ============================================

export function SceneVideoPromptCard({
  sceneId,
  projectId,
  sceneNumber,
  locationName,
  sceneVideoPrompt,
  storyboardStatus,
  ready,
  missingShots,
  isGenerating = false,
  isEvaluating = false,
  onGenerate,
  onEvaluate,
  onSwitchVersion,
  dependencyImages = [],
  onPreviewContext,
}: SceneVideoPromptCardProps) {
  const [switchingVersion, setSwitchingVersion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // 始终展示 is_current 版本（与评分器查询逻辑一致）
  const currentVersion = sceneVideoPrompt?.prompt_versions?.find((v) => v.is_current);

  const canGenerate = ready && storyboardStatus === "ready";
  const missingText = missingShots.length > 0
    ? `镜头 ${missingShots.join("、")} 未生成图片`
    : storyboardStatus !== "ready"
    ? `Storyboard 未就绪 (${storyboardStatus || "未生成"})`
    : "";

  const handleGenerate = async () => {
    if (!canGenerate) {
      toast.error(missingText || "请先生成 Storyboard 和所有镜头图片");
      return;
    }
    onGenerate?.();
  };

  const handleCopy = async () => {
    if (!currentVersion?.content) return;
    const text = [
      currentVersion.content,
      currentVersion.negative_prompt ? `\n--- Negative ---\n${currentVersion.negative_prompt}` : "",
    ].join("");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("已复制到剪贴板");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEvaluate = async () => {
    if (!sceneVideoPrompt?.id) return;
    onEvaluate?.();
  };

  return (
    <Card className={`border-l-4 ${sceneVideoPrompt?.is_stale ? "border-l-amber-500" : "border-l-primary/40"}`}>
      <CardContent className="pt-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">场景 {sceneNumber}</Badge>
            {locationName && <Badge variant="outline">{locationName}</Badge>}
            <Badge variant="secondary">🎬 场景视频</Badge>
          </div>
          <div className="flex items-center gap-2">
            {sceneVideoPrompt?.is_stale && (
              <Badge variant="outline" className="text-amber-500 border-amber-500/40">
                ⚠️ 资产已修改
              </Badge>
            )}
            {sceneVideoPrompt?.quality_score && (
              <Badge
                variant="outline"
                className={
                  sceneVideoPrompt.quality_score >= 4
                    ? "text-green-600 border-green-500/40"
                    : sceneVideoPrompt.quality_score >= 3
                    ? "text-amber-500 border-amber-500/40"
                    : "text-red-500 border-red-500/40"
                }
              >
                质量 {sceneVideoPrompt.quality_score}/5
              </Badge>
            )}
          </div>
        </div>

        {/* 过期原因 */}
        {sceneVideoPrompt?.is_stale && sceneVideoPrompt?.stale_reason && (
          <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-700 dark:text-amber-400">
            {sceneVideoPrompt.stale_reason}
          </div>
        )}

        {/* 质量评语 */}
        {sceneVideoPrompt?.quality_score && sceneVideoPrompt?.quality_note && (
          <div className="mb-3 rounded-lg bg-muted/30 p-2 text-xs text-muted-foreground">
            <span className="font-medium">评分说明：</span>
            {sceneVideoPrompt.quality_note}
          </div>
        )}

        {/* Storyboard Document 已就绪提示 */}
        {storyboardStatus === "ready" && (
          <div className="mb-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-2 text-xs text-green-700 dark:text-green-400">
            ✓ Storyboard 文档已就绪，场景视频 Prompt 可基于文档内容生成
          </div>
        )}

        {/* 依赖图片缩略图（用于视频生成参考） */}
        {dependencyImages.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">参考图片（{dependencyImages.length} 张，用于视频生成）</p>
            <div className="flex flex-wrap gap-2">
              {dependencyImages.map((img, i) => (
                <div key={i} className="relative group flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.label}
                    onClick={() => setPreviewUrl(img.url)}
                    className="w-16 h-16 rounded-lg object-cover border cursor-pointer hover:opacity-80 transition-opacity"
                  />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] text-center py-0.5 rounded-b-lg truncate px-1">
                    {img.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* 预览大图 */}
        <Dialog open={!!previewUrl} onOpenChange={(open) => { if (!open) setPreviewUrl(null); }}>
          <DialogContent className="max-w-2xl p-0 overflow-hidden">
            <DialogTitle className="sr-only">参考图片预览</DialogTitle>
            {previewUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={previewUrl} alt="预览" className="w-full object-contain" />
            )}
          </DialogContent>
        </Dialog>

        {/* 内容 */}
        {currentVersion ? (
          <div className="space-y-3">
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <pre className="whitespace-pre-wrap font-mono text-xs">
                {currentVersion.content}
              </pre>
            </div>
            {currentVersion.negative_prompt && (
              <div className="bg-muted/20 rounded-lg p-3 text-xs">
                <span className="text-muted-foreground font-medium">Negative Prompt:</span>
                <pre className="whitespace-pre-wrap font-mono mt-1">
                  {currentVersion.negative_prompt}
                </pre>
              </div>
            )}

            {/* 版本选择器 — 点击切换 is_current（与评分器保持一致） */}
            {sceneVideoPrompt!.prompt_versions.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">版本:</span>
                {sceneVideoPrompt!.prompt_versions.map((v) => (
                  <button
                    key={v.id}
                    onClick={async () => {
                      if (v.is_current || !onSwitchVersion) return;
                      setSwitchingVersion(v.id);
                      try { await onSwitchVersion(v.id); } finally { setSwitchingVersion(null); }
                    }}
                    disabled={switchingVersion === v.id}
                    className={`text-xs px-2 py-0.5 rounded ${
                      v.is_current
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/70"
                    }`}
                  >
                    v{v.version_number} {v.is_current ? "(当前)" : ""}
                    {switchingVersion === v.id ? " ..." : ""}
                  </button>
                ))}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleCopy} disabled={copied}>
                {copied ? "已复制" : "复制"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleEvaluate} disabled={isEvaluating || isGenerating}>
                {isEvaluating ? "评分中..." : "质量评分"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? "生成中..." : "重新生成"}
              </Button>
              {onPreviewContext && (
                <Button size="sm" variant="ghost" className="text-xs h-8 ml-auto" onClick={onPreviewContext}>
                  🔍 调试信息
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {sceneVideoPrompt === null ? (
              <>
                <p className="text-sm text-muted-foreground">
                  尚未生成场景视频 Prompt
                </p>
                {missingText && (
                  <p className="text-xs text-amber-500">
                    ⚠ {missingText}
                  </p>
                )}
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={!canGenerate || isGenerating}
                >
                  {isGenerating ? "生成中..." : canGenerate ? "生成场景视频 Prompt" : "未就绪"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">加载中...</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
