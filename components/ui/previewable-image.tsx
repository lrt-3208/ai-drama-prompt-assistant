"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * 可点击预览的图片：缩略图原样渲染（cursor-zoom-in），点击弹出大图 Dialog。
 * 供角色/场景卡片头图、Storyboard 文档小图、依赖面板等所有图片展示位统一使用。
 */
export function PreviewableImage({
  src,
  alt,
  className,
  previewCaption,
}: {
  src: string;
  alt: string;
  /** 缩略图样式（沿用原 img 的 className） */
  className?: string;
  /** 预览大图底部的说明文字（可选） */
  previewCaption?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        title="点击查看大图"
        className={`cursor-zoom-in ${className || ""}`}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">{alt} 预览</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="w-full object-contain" />
          {previewCaption && (
            <p className="px-4 py-2.5 text-xs text-muted-foreground border-t border-border">
              {previewCaption}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
