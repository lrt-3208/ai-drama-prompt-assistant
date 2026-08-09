"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, X, Loader2 } from "lucide-react";

interface StoryboardData {
  id: string;
  status: string;
  version_number: number;
  assistant_prompt: string | null;
  storyboard_image: string | null;
  is_stale: boolean;
  stale_reason: string | null;
}

interface DependencyImage {
  url: string;
  label: string;
  kind: "character" | "location" | "shot";
}

interface StoryboardVersion {
  id: string;
  version_number: number;
  is_current: boolean;
  source: string;
  ai_model: string | null;
  assistant_prompt: string;
}

interface StoryboardAssetCardProps {
  projectId: string;
  sceneId: string;
  sceneNumber: number;
  storyboard: StoryboardData | null;
  storyboardVersions?: StoryboardVersion[];
  missingShots: number[];
  ready: boolean;
  isGenerating?: boolean;
  onGenerate?: () => void;
  onSwitchVersion?: (versionId: string) => void;
  dependencyImages?: DependencyImage[];
  onImageChange?: (url: string | null) => void;
  onPreviewContext?: () => void;
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
  storyboardVersions = [],
  missingShots,
  ready,
  isGenerating = false,
  onGenerate,
  onSwitchVersion,
  dependencyImages = [],
  onImageChange,
  onPreviewContext,
}: StoryboardAssetCardProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [switchingVersion, setSwitchingVersion] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  // Storyboard 图片上传状态
  const [uploading, setUploading] = useState(false);
  const [imgPreviewUrl, setImgPreviewUrl] = useState<string | null>(null);
  const [sbImagePreview, setSbImagePreview] = useState(false);
  const [depPreviewUrl, setDepPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sbImage = storyboard?.storyboard_image || imgPreviewUrl;
  const hasSbImage = !!sbImage;

  const handleUploadImage = useCallback(async (file: File) => {
    if (!storyboard?.id) {
      toast.error("Storyboard 尚未创建");
      return;
    }
    setUploading(true);
    try {
      // 1. 上传到 TOS + 创建 asset 记录
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      formData.append("entityType", "storyboard");
      formData.append("entityId", storyboard.id);
      formData.append("assetType", "storyboard_image");
      const res = await fetch("/api/assets/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "上传失败");

      // 2. PATCH storyboard 存储 URL
      const patchRes = await fetch(
        `/api/projects/${projectId}/storyboards/${sceneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyboard_image: data.url }),
        }
      );
      if (!patchRes.ok) throw new Error("保存图片关联失败");

      setImgPreviewUrl(data.url);
      toast.success("故事板图片上传成功");
      onImageChange?.(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }, [storyboard?.id, projectId, sceneId, router]);

  const handleDeleteImage = useCallback(async () => {
    if (!storyboard?.id) return;
    setUploading(true);
    try {
      await fetch(
        `/api/projects/${projectId}/storyboards/${sceneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyboard_image: "" }),
        }
      );
      setImgPreviewUrl(null);
      toast.success("已删除故事板图片");
      onImageChange?.(null);
    } catch {
      toast.error("删除失败");
    } finally {
      setUploading(false);
    }
  }, [storyboard?.id, projectId, sceneId, router]);

  const status = storyboard?.status || null;
  const statusInfo = status ? STATUS_LABELS[status] : null;
  // 修复：始终允许重新生成（只要有图片就行）
  const canGenerate = ready;

  // 当前版本和选中版本（类似 SceneVideoPromptCard 的版本预览逻辑）
  // 容错：即使 DB 中多个版本 is_current=true，也只取 version_number 最高的那个作为「当前」
  // （storyboardVersions 已按 version_number DESC 排序）
  const currentVersion = storyboardVersions.find((v) => v.is_current);
  const selectedVersion = storyboardVersions.find((v) => v.id === selectedVersionId) || currentVersion;
  // 显示的内容：优先用选中版本的 assistant_prompt，其次用 storyboard 主表的
  const displayPrompt = selectedVersion?.assistant_prompt ?? storyboard?.assistant_prompt ?? null;

  const missingText = missingShots.length > 0
    ? `镜头 ${missingShots.join("、")} 未生成图片`
    : !ready
    ? "场景无镜头数据"
    : "";

  const handleGenerate = async () => {
    if (!ready) {
      toast.error(missingText || "请先确保所有镜头都有图片");
      return;
    }
    onGenerate?.();
  };

  const handleCopy = async () => {
    if (!displayPrompt) return;
    await navigator.clipboard.writeText(displayPrompt);
    setCopied(true);
    toast.success("已复制到剪贴板");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = () => {
    setEditText(displayPrompt || "");
    setEditing(true);
  };

  const handleSave = async () => {
    if (!editText.trim()) {
      toast.error("提示词不能为空");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/storyboards/${sceneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assistant_prompt: editText.trim() }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "保存失败");
      }
      toast.success("Storyboard 描述已更新，关联的场景视频 Prompt 将标记为过期");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={`border-l-4 ${storyboard?.is_stale ? "border-l-amber-500" : "border-l-indigo-500/40"}`}>
      <CardContent className="pt-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">场景 {sceneNumber}</Badge>
            <Badge variant="outline">🎬 Storyboard</Badge>
            {statusInfo && (
              <Badge variant={statusInfo.variant} className="text-xs">
                {statusInfo.text}
              </Badge>
            )}
            {storyboard && (
              <span className="text-xs text-muted-foreground">v{storyboard.version_number}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {storyboard?.is_stale && (
              <Badge variant="outline" className="text-amber-500 border-amber-500/40">
                ⚠️ 已过期
              </Badge>
            )}
          </div>
        </div>

        {/* 过期原因 */}
        {storyboard?.is_stale && storyboard?.stale_reason && (
          <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-700 dark:text-amber-400">
            {storyboard.stale_reason}
          </div>
        )}

        {/* 依赖图片缩略图（生成 prompt 需要的素材） */}
        {dependencyImages.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">依赖图片（{dependencyImages.length} 张）</p>
            <div className="flex flex-wrap gap-2">
              {dependencyImages.map((img, i) => (
                <div key={i} className="relative group flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.label}
                    onClick={() => setDepPreviewUrl(img.url)}
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
        {/* 依赖图片预览大图 */}
        <Dialog open={!!depPreviewUrl} onOpenChange={(open) => { if (!open) setDepPreviewUrl(null); }}>
          <DialogContent className="max-w-2xl p-0 overflow-hidden">
            <DialogTitle className="sr-only">依赖图片预览</DialogTitle>
            {depPreviewUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={depPreviewUrl} alt="预览" className="w-full object-contain" />
            )}
          </DialogContent>
        </Dialog>

        {/* 内容 */}
        {/* Storyboard 图片上传/预览 */}
        <div className="mb-3">
          <div className="flex items-center gap-3">
            <div className="relative group flex-shrink-0">
              {hasSbImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sbImage!}
                    alt="故事板图片"
                    onClick={() => setSbImagePreview(true)}
                    className="w-24 h-24 rounded-lg object-cover border cursor-pointer hover:opacity-80 transition-opacity"
                  />
                  <button
                    onClick={handleDeleteImage}
                    disabled={uploading}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {uploading ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => storyboard?.id && inputRef.current?.click()}
                  disabled={uploading || !storyboard?.id}
                  className={`w-24 h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-colors ${
                    !storyboard?.id
                      ? "border-muted-foreground/20 text-muted-foreground/30 cursor-not-allowed"
                      : "border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  {uploading ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <>
                      <Upload className="size-5" />
                      <span className="text-[10px] mt-1">上传故事板图</span>
                    </>
                  )}
                </button>
              )}
            </div>
            {hasSbImage && (
              <span className="text-xs text-muted-foreground">点击预览，悬停删除</span>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUploadImage(file);
            e.target.value = "";
          }}
        />
        {/* 预览大图 */}
        <Dialog open={sbImagePreview} onOpenChange={setSbImagePreview}>
          <DialogContent className="max-w-2xl p-0 overflow-hidden">
            <DialogTitle className="sr-only">故事板图片预览</DialogTitle>
            {sbImage && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={sbImage} alt="故事板图片" className="w-full object-contain" />
            )}
          </DialogContent>
        </Dialog>
        {displayPrompt && !editing ? (
          <div className="space-y-3">
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">AI 辅助提示词（场景连续性描述）</p>
              {selectedVersion && !selectedVersion.is_current && (
                <p className="text-xs text-amber-500 mb-1">⚠ 正在查看历史版本 v{selectedVersion.version_number}</p>
              )}
              <pre className="whitespace-pre-wrap font-mono text-xs">
                {displayPrompt}
              </pre>
            </div>
            {/* 版本选择器 — 类似场景视频 Prompt 的版本预览 */}
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
                {/* 切换到当前选中版本（非当前版本时显示） */}
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
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleCopy} disabled={copied}>
                {copied ? "已复制" : "复制"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleEdit}>
                编辑
              </Button>
              <Button size="sm" variant="outline" onClick={handleGenerate} disabled={isGenerating || !canGenerate}>
                {isGenerating ? "生成中..." : "重新生成"}
              </Button>
              {onPreviewContext && (
                <Button size="sm" variant="ghost" className="text-xs" onClick={onPreviewContext}>
                  调试信息
                </Button>
              )}
            </div>
          </div>
        ) : editing ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">编辑辅助提示词</p>
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="min-h-[120px] font-mono text-xs"
                placeholder="描述镜头排列和场景连续性..."
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "保存中..." : "保存"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {status === "draft"
                ? "Storyboard 已创建但尚未生成资产"
                : "尚未创建 Storyboard"}
            </p>
            {missingText && (
              <p className="text-xs text-amber-500">⚠ {missingText}</p>
            )}
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
            >
              {isGenerating ? "生成中..." : canGenerate ? "生成 Storyboard" : "未就绪"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
