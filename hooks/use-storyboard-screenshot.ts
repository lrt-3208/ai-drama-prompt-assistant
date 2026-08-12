"use client";

import { useState, useCallback } from "react";
import { toPng } from "html-to-image";

/**
 * 客户端 DOM 截图 Hook
 *
 * 使用 html-to-image 的 toPng() 捕获指定 DOM 元素
 * 基于 SVG foreignObject，对 CSS Grid 布局和 SVG 元素（情绪曲线）支持更好
 *
 * CORS 修复：截图前将所有跨域 <img> 通过 /api/image-proxy 代理获取并转为
 * base64 data URL，避免 canvas 被 cross-origin 图片 tainted 导致 SecurityError
 *
 * @returns { capture, isCapturing }
 */
export function useStoryboardScreenshot() {
  const [isCapturing, setIsCapturing] = useState(false);

  const capture = useCallback(async (elementId: string): Promise<string> => {
    const element = document.getElementById(elementId);
    if (!element) {
      throw new Error(`截图目标元素 #${elementId} 不存在`);
    }

    setIsCapturing(true);

    // 保存原始 src，截图后恢复
    const images = Array.from(element.querySelectorAll("img"));
    const originalSrcs = images.map((img) => img.getAttribute("src") || "");

    try {
      // Phase 1: 通过代理获取跨域图片并转为 data URL
      await Promise.all(
        images.map(async (img) => {
          const src = img.getAttribute("src") || "";
          if (!src || src.startsWith("data:")) return;
          try {
            const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(src)}`;
            const response = await fetch(proxyUrl);
            if (!response.ok) return;
            const blob = await response.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            img.setAttribute("src", dataUrl);
          } catch (e) {
            console.warn("[screenshot] 图片内联失败:", src, e);
          }
        })
      );

      // Phase 2: 等待所有图片（已替换为 data URL）加载完成
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            const handle = () => resolve();
            img.addEventListener("load", handle, { once: true });
            img.addEventListener("error", handle, { once: true });
          });
        })
      );

      // Phase 3: 截图
      const dataUrl = await toPng(element, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      return dataUrl;
    } finally {
      // 恢复原始 src
      images.forEach((img, i) => {
        if (originalSrcs[i]) {
          img.setAttribute("src", originalSrcs[i]);
        }
      });
      setIsCapturing(false);
    }
  }, []);

  return { capture, isCapturing };
}
