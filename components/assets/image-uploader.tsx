"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface ImageUploaderProps {
  projectId: string;
  entityType: "character" | "location" | "visual_style" | "shot" | "prompt";
  entityId: string;
  assetType: string;
  assetId?: string | null;
  /** 图片公共 URL（由服务端构造，公共读桶无需签名） */
  url?: string | null;
  onUploaded?: (assetId: string, url: string) => void;
  onDeleted?: () => void;
  className?: string;
  /** 上传区域提示文字 */
  hint?: string;
}

/**
 * 图片上传组件
 * - 拖拽 / 点击上传
 * - 预览（直接使用公共 URL，无需签名）
 * - 删除（软删除）
 * - 上传中 / 错误状态显示
 */
export function ImageUploader({
  projectId,
  entityType,
  entityId,
  assetType,
  assetId,
  url,
  onUploaded,
  onDeleted,
  className,
  hint = "拖拽图片或点击上传",
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // 上传后本地保存 URL（API 直接返回公共 URL，无需再请求）
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayUrl = uploadedUrl || url;

  const handleUpload = useCallback(
    async (file: File) => {
      if (!file) return;

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("projectId", projectId);
        formData.append("entityType", entityType);
        formData.append("entityId", entityId);
        formData.append("assetType", assetType);

        const res = await fetch("/api/assets/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "上传失败");
        }

        // API 直接返回公共 URL，本地保存用于即时预览
        setUploadedUrl(data.url);
        toast.success("图片上传成功");
        onUploaded?.(data.assetId, data.url);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploading(false);
      }
    },
    [projectId, entityType, entityId, assetType, onUploaded]
  );

  const handleDelete = useCallback(async () => {
    if (!assetId) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "删除失败");
      }

      setUploadedUrl(null);
      toast.success("图片已删除");
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }, [assetId, onDeleted]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleUpload(file);
      }
      // 清空 input 以允许重复上传同一文件
      e.target.value = "";
    },
    [handleUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        handleUpload(file);
      }
    },
    [handleUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  // 有图片时显示预览
  const hasImage = !!assetId && !!displayUrl;

  return (
    <div className={cn("relative", className)}>
      {/* 1. 已有图片 + URL → 显示图片 */}
      {hasImage && (
        <div className="group relative aspect-video overflow-hidden rounded-lg border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl!}
            alt="preview"
            className="h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-105"
            onClick={() => setPreviewOpen(true)}
          />
          {/* 悬浮操作栏 */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-3 py-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="text-xs text-white/80">点击图片预览</span>
            <Button
              variant="destructive"
              size="xs"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <X className="size-3" />
              )}
              删除
            </Button>
          </div>
        </div>
      )}

      {/* 2. 有 assetId 但无 URL → 显示占位 */}
      {assetId && !displayUrl && (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30">
          <ImageIcon className="size-6 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground/70">图片加载中</span>
        </div>
      )}

      {/* 3. 无 assetId → 上传区域 */}
      {!assetId && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted",
            dragOver && "border-primary bg-primary/5",
            uploading && "pointer-events-none opacity-50"
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="size-6 animate-spin" />
              <span className="text-xs">上传中...</span>
            </>
          ) : (
            <>
              <Upload className="size-6" />
              <span className="text-xs">{hint}</span>
              <span className="text-[10px] text-muted-foreground/70">
                PNG / JPG / WebP, 最大 10MB
              </span>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* 图片预览 Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {displayUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={displayUrl}
              alt="preview full"
              className="w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
