"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, ChevronDown, ChevronUp, Copy } from "lucide-react";
import type { StoryboardDocument, StoryboardRenderData, CharacterRef } from "@/lib/storyboard/document-types";
import { StoryboardDocumentView } from "@/components/storyboard/document";
import { useStoryboardScreenshot } from "@/hooks/use-storyboard-screenshot";

interface StoryboardData {
  id: string;
  status: string;
  version_number: number;
  document: StoryboardDocument | null;
  storyboard_image_asset_id: string | null;
  optimized_image_prompt: string | null;
  is_stale: boolean;
  stale_reason: string | null;
}

interface DependencyImage {
  url: string;
  label: string;
  kind: "character" | "location" | "shot" | "storyboard";
}

interface StoryboardVersion {
  id: string;
  version_number: number;
  is_current: boolean;
  source: string;
  ai_model: string | null;
  document: StoryboardDocument;
}

interface StoryboardAssetCardProps {
  projectId: string;
  sceneId: string;
  sceneNumber: number;
  storyboard: StoryboardData | null;
  storyboardImageUrl?: string | null;
  optimizedImageUrl?: string | null;
  storyboardVersions?: StoryboardVersion[];
  missingShots: number[];
  ready: boolean;
  isGenerating?: boolean;
  isImageGenerating?: boolean;
  onGenerate?: () => void;
  onSwitchVersion?: (versionId: string) => void;
  dependencyImages?: DependencyImage[];
  projectName?: string;
  episodeTitle?: string;
  locationName?: string;
  totalShots?: number;
  characters?: CharacterRef[];
  locationImageUrl?: string | null;
  frameImages?: Record<number, string>;
}

const STATUS_LABELS: Record<string, { text: string; variant: "secondary" | "default" | "destructive" | "outline" }> = {
  draft: { text: "草稿", variant: "outline" },
  ready: { text: "已就绪", variant: "default" },
  generated: { text: "已生成", variant: "secondary" },
  failed: { text: "生成失败", variant: "destructive" },
};

export function StoryboardAssetCard({
  projectId,
  sceneId,
  sceneNumber,
  storyboard,
  storyboardImageUrl = null,
  optimizedImageUrl = null,
  storyboardVersions = [],
  missingShots,
  ready,
  isGenerating = false,
  isImageGenerating = false,
  onGenerate,
  onSwitchVersion,
  dependencyImages = [],
  projectName = "",
  episodeTitle = "",
  locationName = "",
  totalShots = 0,
  characters = [],
  locationImageUrl = null,
  frameImages = {},
}: StoryboardAssetCardProps) {
  const router = useRouter();
  const { capture, isCapturing } = useStoryboardScreenshot();
  const [switchingVersion, setSwitchingVersion] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [depPreviewUrl, setDepPreviewUrl] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [showOptimizationPrompt, setShowOptimizationPrompt] = useState(false);
  const [showDocumentPreview, setShowDocumentPreview] = useState(false);
  const [uploadingOptimized, setUploadingOptimized] = useState(false);
  const optimizedInputRef = useRef<HTMLInputElement>(null);

  const status = storyboard?.status || null;
  const statusInfo = status ? STATUS_LABELS[status] : null;
  const canGenerate = ready;

  const currentVersion = storyboardVersions.find((v) => v.is_current);
  const selectedVersion = storyboardVersions.find((v) => v.id === selectedVersionId) || currentVersion;
  const displayDocument = selectedVersion?.document ?? storyboard?.document ?? null;

  const handleGenerate = async () => {
    if (!ready) {
      toast.error("场景无镜头数据");
      return;
    }
    onGenerate?.();
  };

  // 生成粗稿图片：离屏截图 → 上传 → 创建任务 → 轮询
  const handleGenerateImage = useCallback(async () => {
    if (!displayDocument) {
      toast.error("请先生成 Storyboard 文档");
      return;
    }

    setGeneratingImage(true);

    try {
      // 1. 等待一帧确保离屏 DOM 已渲染
      await new Promise((resolve) => requestAnimationFrame(resolve));

      // 2. 截图（离屏元素，用户不可见）
      const screenshot = await capture("storyboard-document");

      // 3. 发送到 API
      const res = await fetch(
        `/api/projects/${projectId}/storyboards/${sceneId}/image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ screenshot }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "创建图片生成任务失败");
      }

      toast.success("正在生成粗稿截图...");

      // 4. 轮询任务状态
      const pollTask = async () => {
        try {
          const taskRes = await fetch(`/api/tasks/${data.taskId}`);
          if (!taskRes.ok) return;
          const taskData = await taskRes.json();

          if (["success", "partial"].includes(taskData.status)) {
            setGeneratingImage(false);
            toast.success("粗稿图片和优化提示词已生成");
            router.refresh();
          } else if (taskData.status === "failed") {
            setGeneratingImage(false);
            toast.error("粗稿图片生成失败", {
              description: taskData.error?.reason || "请重试",
            });
          } else {
            setTimeout(pollTask, 3000);
          }
        } catch {
          setTimeout(pollTask, 5000);
        }
      };
      setTimeout(pollTask, 2000);
    } catch (e) {
      setGeneratingImage(false);
      toast.error(e instanceof Error ? e.message : "生成失败");
    }
  }, [displayDocument, capture, projectId, sceneId, router]);

  // 上传优化图：外部工具（Midjourney/Seedream 等）生成的整页优化分镜图回传
  const handleOptimizedFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // 允许重复选择同一文件
      if (!file) return;

      setUploadingOptimized(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("projectId", projectId);
        fd.append("entityType", "storyboard");
        fd.append("entityId", sceneId);
        fd.append("assetType", "storyboard_image_optimized");

        const res = await fetch("/api/assets/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          // migration_v33 未执行时的典型报错：CHECK 约束拒绝 / 列不存在
          const detail = data.detail || data.error || "";
          if (detail.includes("optimized_image_asset_id") || detail.includes("check constraint")) {
            throw new Error("数据库尚未支持优化图存储，请先在 Supabase 执行 supabase/migration_v33.sql");
          }
          throw new Error(data.error || "上传失败");
        }

        toast.success("优化图已上传");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploadingOptimized(false);
      }
    },
    [projectId, sceneId, router]
  );

  // 构建渲染数据
  const renderData: StoryboardRenderData | null = displayDocument
    ? {
        projectName,
        episodeTitle,
        sceneNumber,
        locationName,
        totalShots,
        document: displayDocument,
        characters,
        locationImageUrl,
        frameImages,
      }
    : null;

  return (
    <div
      className={`bg-background/60 border rounded-lg p-3.5 ${
        storyboard?.is_stale ? "border-stale/40" : "border-border"
      }`}
    >
      <div>
        {/* 头部 */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border">
              场景 {sceneNumber}
            </span>
            {statusInfo && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  storyboard?.status === "ready"
                    ? "bg-green-500/15 text-green-400 border-green-500/30"
                    : "bg-surface2 text-muted-foreground border-border"
                }`}
              >
                {statusInfo.text}
              </span>
            )}
            {storyboard && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border font-mono">
                v{storyboard.version_number}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {storyboard?.is_stale && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-stale/20 text-stale border border-stale/40">
                ⚠ 已过期
              </span>
            )}
          </div>
        </div>

        {/* 过期原因 */}
        {storyboard?.is_stale && storyboard?.stale_reason && (
          <div className="mb-2.5 rounded bg-stale/10 border border-stale/25 p-2 text-[10px] text-stale">
            {storyboard.stale_reason}
          </div>
        )}

        {/* 依赖图片缩略图 */}
        {dependencyImages.length > 0 && (
          <div className="mb-2.5">
            <p className="text-[9px] text-muted-foreground mb-1.5">
              依赖图片（{dependencyImages.length} 张）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dependencyImages.map((img, i) => (
                <div key={i} className="relative group flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.label}
                    onClick={() => setDepPreviewUrl(img.url)}
                    title={img.label}
                    className="w-10 h-10 rounded object-cover border border-border cursor-pointer hover:border-primary/50 transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 内容区域 */}
        {displayDocument ? (
          <div className="space-y-3">
            {/* 版本选择器 */}
            {storyboardVersions.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">版本:</span>
                {storyboardVersions.map((v) => {
                  const isCurrent = v.id === currentVersion?.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVersionId(isCurrent ? null : v.id)}
                      className={`text-xs px-2 py-0.5 rounded transition-colors ${
                        (isCurrent && !selectedVersionId) || selectedVersionId === v.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/70"
                      }`}
                    >
                      v{v.version_number} {isCurrent ? "(当前)" : ""}
                    </button>
                  );
                })}
                {selectedVersion && selectedVersion.id !== currentVersion?.id && onSwitchVersion && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs ml-auto"
                    disabled={switchingVersion === selectedVersion.id}
                    onClick={async () => {
                      setSwitchingVersion(selectedVersion.id);
                      try { await onSwitchVersion(selectedVersion.id); } finally { setSwitchingVersion(null); }
                    }}
                  >
                    {switchingVersion === selectedVersion.id ? "切换中..." : "切换到此版本"}
                  </Button>
                )}
              </div>
            )}

            {/* 操作按钮 — 原型小胶囊样式 */}
            <div className="flex items-center gap-2 flex-wrap text-[9px]">
              <button
                onClick={() => setShowDocumentPreview(true)}
                disabled={!displayDocument}
                className="px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                👁 预览文档
              </button>
              <button
                onClick={handleGenerateImage}
                disabled={generatingImage || isCapturing || isImageGenerating || !displayDocument}
                className="px-2 py-0.5 rounded bg-surface2 border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generatingImage || isCapturing || isImageGenerating
                  ? isCapturing
                    ? "截图中..."
                    : "生成中..."
                  : storyboardImageUrl
                  ? "⬇ 重新导出 PNG"
                  : "⬇ 导出 PNG"}
              </button>
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !canGenerate}
                className="text-muted-foreground hover:text-primary transition ml-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isGenerating ? "⟳ 生成文档中..." : "⟳ 重新生成"}
              </button>
              <span className="text-muted-foreground/60 ml-auto hidden sm:inline">
                HTML 渲染直出，1400px @2x
              </span>
            </div>

            {/* 流程提示 */}
            <p className="text-[9px] text-muted-foreground leading-relaxed">
              粗稿图片 = 文档截图；用粗稿 + 优化提示词在 Midjourney / Seedream 等工具生成优化图后，点击「上传优化图」回传
            </p>

            {/* 粗稿图片 + 优化图 + 优化提示词 */}
            {storyboardImageUrl ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative group flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={storyboardImageUrl}
                      alt="故事板粗稿图片"
                      onClick={() => setDepPreviewUrl(storyboardImageUrl)}
                      className="w-16 h-16 rounded-lg object-cover border cursor-pointer hover:opacity-80 transition-opacity"
                    />
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] text-center py-0.5 rounded-b-lg truncate px-1">
                      粗稿
                    </span>
                  </div>
                  {/* 优化图：外部生成后上传回传 */}
                  {optimizedImageUrl ? (
                    <div className="relative group flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={optimizedImageUrl}
                        alt="故事板优化图片"
                        onClick={() => setDepPreviewUrl(optimizedImageUrl)}
                        className="w-16 h-16 rounded-lg object-cover border border-primary/40 cursor-pointer hover:opacity-80 transition-opacity"
                      />
                      <span className="absolute bottom-0 left-0 right-0 bg-primary/80 text-white text-[8px] text-center py-0.5 rounded-b-lg truncate px-1">
                        优化
                      </span>
                      <button
                        onClick={() => optimizedInputRef.current?.click()}
                        title="替换优化图"
                        disabled={uploadingOptimized}
                        className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center size-5 rounded bg-black/60 text-white text-[10px] hover:bg-black/80 transition disabled:opacity-50"
                      >
                        ⟳
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => optimizedInputRef.current?.click()}
                      disabled={uploadingOptimized}
                      title="上传在外部工具生成的优化分镜图"
                      className="w-16 h-16 rounded-lg border border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition text-[9px] disabled:opacity-50"
                    >
                      {uploadingOptimized ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <span className="text-base leading-none">⬆</span>
                      )}
                      {uploadingOptimized ? "上传中" : "上传优化图"}
                    </button>
                  )}
                  <input
                    ref={optimizedInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleOptimizedFileChange}
                  />
                </div>
                {/* 优化提示词（可折叠 + 复制） */}
                {storyboard?.optimized_image_prompt && (
                  <div className="rounded-lg bg-muted/30 border">
                    <div className="w-full flex items-center justify-between px-3 py-2">
                      <button
                        onClick={() => setShowOptimizationPrompt(!showOptimizationPrompt)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        优化提示词
                        {showOptimizationPrompt ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(storyboard.optimized_image_prompt || "");
                          toast.success("已复制到剪贴板");
                        }}
                      >
                        <Copy className="size-3 mr-1" />
                        复制
                      </Button>
                    </div>
                    {showOptimizationPrompt && (
                      <pre className="px-3 pb-3 text-[10px] text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
                        {storyboard.optimized_image_prompt}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-muted/20 border border-dashed p-3 text-center text-xs text-muted-foreground">
                尚未导出粗稿图片（粗稿图片 = 整页文档截图），点击上方「⬇ 导出 PNG」按钮，自动生成粗稿图 + 优化提示词
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {status === "draft"
                ? "Storyboard 已创建但尚未生成文档"
                : "尚未创建 Storyboard"}
            </p>
            {missingShots.length > 0 && (
              <p className="text-xs text-amber-500">⚠ 镜头 {missingShots.join("、")} 未生成图片</p>
            )}
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                  生成中...
                </>
              ) : canGenerate ? "生成 Storyboard 文档" : "未就绪"}
            </Button>
          </div>
        )}
      </div>

      {/* 离屏渲染区域 — 供截图使用，用户不可见 */}
      {renderData && (
        <div
          style={{ position: "fixed", left: "-9999px", top: 0, width: "1400px", pointerEvents: "none", opacity: 0 }}
          aria-hidden="true"
        >
          <StoryboardDocumentView data={renderData} />
        </div>
      )}

      {/* 文档预览 — 展示 Storyboard JSON 数据 */}
      <Dialog open={showDocumentPreview} onOpenChange={setShowDocumentPreview}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium">Storyboard 文档数据</DialogTitle>
            {displayDocument && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(displayDocument, null, 2));
                  toast.success("JSON 已复制到剪贴板");
                }}
              >
                <Copy className="size-3 mr-1" />
                复制 JSON
              </Button>
            )}
          </div>
          {displayDocument && (
            <pre className="text-xs whitespace-pre-wrap break-words overflow-auto font-mono text-muted-foreground">
              {JSON.stringify(displayDocument, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>

      {/* 依赖图片预览大图 */}
      <Dialog open={!!depPreviewUrl} onOpenChange={(open) => { if (!open) setDepPreviewUrl(null); }}>
        <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {depPreviewUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={depPreviewUrl} alt="预览" className="w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
