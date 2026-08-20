"use client";

// ============================================
// 镜头帧卡片 — 故事板文档内的单帧
// 缩略图 + 红色镜号角标 + 完整标注（不截断，文档用于阅读）
// ============================================

import type { StoryboardFrame } from "@/lib/storyboard/document-types";
import { PreviewableImage } from "@/components/ui/previewable-image";

interface FrameCardProps {
  frame: StoryboardFrame;
  imageUrl?: string;
}

export function FrameCard({ frame, imageUrl }: FrameCardProps) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
      {/* 缩略图 + 镜号角标 */}
      <div className="relative aspect-video overflow-hidden bg-gray-100">
        {imageUrl ? (
          <PreviewableImage
            src={imageUrl}
            alt={`镜头 ${frame.shot_number}`}
            className="h-full w-full object-cover"
            previewCaption={`镜头 ${frame.shot_number} · 帧画面`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">
            暂无缩略图
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white shadow">
          {frame.shot_number}
        </span>
      </div>

      {/* 标注区 */}
      <div className="space-y-1.5 p-2.5">
        {/* 景别 + 情绪标签 */}
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
            S{frame.shot_number} · {frame.shot_type}
          </span>
          <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
            {frame.emotion}
          </span>
        </div>

        {/* 镜头描述 — 完整展示，不截断 */}
        <p className="text-[11px] leading-relaxed text-gray-700">{frame.description}</p>

        {/* 运镜 / 光影 / 衔接 */}
        <div className="space-y-0.5 border-t border-gray-100 pt-1.5 text-[10px] leading-snug">
          <p>
            <span className="font-semibold text-gray-900">运镜：</span>
            <span className="text-gray-600">{frame.camera_movement}</span>
          </p>
          <p>
            <span className="font-semibold text-gray-900">光影：</span>
            <span className="text-gray-600">{frame.lighting}</span>
          </p>
          <p>
            <span className="font-semibold text-gray-900">衔接：</span>
            <span className="text-gray-600">{frame.transition}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
