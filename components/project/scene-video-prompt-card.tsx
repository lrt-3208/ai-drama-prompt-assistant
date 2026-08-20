"use client";

import { useState } from "react";
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
    <div
      className={`bg-background/60 border rounded-lg p-3.5 ${
        sceneVideoPrompt?.is_stale ? "border-stale/40" : "border-border"
      }`}
    >
      <div>
        {/* 头部 */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border">
              场景 {sceneNumber}
            </span>
            {locationName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border">
                {locationName}
              </span>
            )}
            {currentVersion && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
                已生成
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {sceneVideoPrompt?.is_stale && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-stale/20 text-stale border border-stale/40">
                ⚠ 资产已修改
              </span>
            )}
            {sceneVideoPrompt?.quality_score && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  sceneVideoPrompt.quality_score >= 4
                    ? "text-green-400 border-green-500/30 bg-green-500/10"
                    : sceneVideoPrompt.quality_score >= 3
                    ? "text-stale border-stale/30 bg-stale/10"
                    : "text-red-400 border-red-500/30 bg-red-500/10"
                }`}
              >
                {sceneVideoPrompt.quality_score}/5
              </span>
            )}
          </div>
        </div>

        {/* 过期原因 */}
        {sceneVideoPrompt?.is_stale && sceneVideoPrompt?.stale_reason && (
          <div className="mb-2.5 rounded bg-stale/10 border border-stale/25 p-2 text-[10px] text-stale">
            {sceneVideoPrompt.stale_reason}
          </div>
        )}

        {/* 质量评语 */}
        {sceneVideoPrompt?.quality_score && sceneVideoPrompt?.quality_note && (
          <div className="mb-2.5 rounded bg-surface2 p-2 text-[9px] text-muted-foreground">
            <span className="font-medium">评分说明：</span>
            {sceneVideoPrompt.quality_note}
          </div>
        )}

        {/* 前置条件（原型：② + shot_image 就绪状态） */}
        <div className="mb-2.5 flex items-center gap-2 flex-wrap text-[9px]">
          <span className="text-muted-foreground">前置条件：</span>
          <span
            className={`px-1.5 py-0.5 rounded ${
              storyboardStatus === "ready"
                ? "bg-green-500/15 text-green-400"
                : "bg-stale/15 text-stale"
            }`}
          >
            ② Storyboard Document {storyboardStatus === "ready" ? "✓" : "未就绪"}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded ${
              missingShots.length === 0
                ? "bg-green-500/15 text-green-400"
                : "bg-stale/15 text-stale"
            }`}
          >
            {missingShots.length === 0
              ? "shot_image 全部已回传 ✓"
              : `镜头 ${missingShots.join("、")} 缺图`}
          </span>
        </div>

        {/* 依赖图片缩略图（用于视频生成参考） */}
        {dependencyImages.length > 0 && (
          <div className="mb-2.5">
            <p className="text-[9px] text-muted-foreground mb-1.5">
              参考图片（{dependencyImages.length} 张，用于视频生成）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dependencyImages.map((img, i) => (
                <div key={i} className="relative group flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.label}
                    onClick={() => setPreviewUrl(img.url)}
                    title={img.label}
                    className="w-10 h-10 rounded object-cover border border-border cursor-pointer hover:border-primary/50 transition-colors"
                  />
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
          <div className="space-y-2.5">
            <div className="bg-surface2 rounded p-2.5">
              <pre className="whitespace-pre-wrap font-mono text-[10px] text-muted-foreground leading-relaxed">
                {currentVersion.content}
              </pre>
            </div>
            {currentVersion.negative_prompt && (
              <div className="bg-surface2/60 rounded p-2.5">
                <div className="text-[9px] text-muted-foreground mb-1">negative_prompt</div>
                <pre className="whitespace-pre-wrap font-mono text-[9px] text-muted-foreground/80 leading-relaxed">
                  {currentVersion.negative_prompt}
                </pre>
              </div>
            )}

            {/* 版本选择器 — 点击切换 is_current（与评分器保持一致） */}
            {sceneVideoPrompt!.prompt_versions.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap text-[9px]">
                <span className="text-muted-foreground">版本:</span>
                {sceneVideoPrompt!.prompt_versions.map((v) => (
                  <button
                    key={v.id}
                    onClick={async () => {
                      if (v.is_current || !onSwitchVersion) return;
                      setSwitchingVersion(v.id);
                      try { await onSwitchVersion(v.id); } finally { setSwitchingVersion(null); }
                    }}
                    disabled={switchingVersion === v.id}
                    className={`px-1.5 py-0.5 rounded transition-colors ${
                      v.is_current
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface2 border border-border text-muted-foreground hover:text-primary hover:border-primary/40"
                    }`}
                  >
                    v{v.version_number}
                    {v.is_current ? " (当前)" : ""}
                    {switchingVersion === v.id ? " ..." : ""}
                  </button>
                ))}
              </div>
            )}

            {/* 操作按钮 — 原型小胶囊样式 */}
            <div className="flex items-center gap-2 flex-wrap text-[9px] pt-2 border-t border-border">
              <button
                onClick={handleCopy}
                disabled={copied}
                className="px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition disabled:opacity-50"
              >
                {copied ? "✓ 已复制" : "📋 复制"}
              </button>
              <button
                onClick={handleEvaluate}
                disabled={isEvaluating || isGenerating}
                className="px-2 py-0.5 rounded bg-surface2 border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition disabled:opacity-40"
              >
                {isEvaluating ? "评分中..." : "★ 质量评分"}
              </button>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="text-muted-foreground hover:text-primary transition ml-1 disabled:opacity-40"
              >
                {isGenerating ? "⟳ 生成中..." : "⟳ 重新生成"}
              </button>
              {onPreviewContext && (
                <button
                  onClick={onPreviewContext}
                  className="text-muted-foreground/70 hover:text-primary transition ml-auto"
                >
                  🔍 调试信息
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {sceneVideoPrompt === null ? (
              <>
                <p className="text-[10px] text-muted-foreground">
                  尚未生成场景视频 Prompt
                </p>
                {missingText && (
                  <p className="text-[10px] text-stale">⚠ {missingText}</p>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate || isGenerating}
                  className={`text-[10px] px-2.5 py-1 rounded transition ${
                    canGenerate
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-surface2 border border-border text-muted-foreground/50 cursor-not-allowed"
                  }`}
                >
                  {isGenerating ? "生成中..." : canGenerate ? "生成场景视频 Prompt" : "未就绪"}
                </button>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground">加载中...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
