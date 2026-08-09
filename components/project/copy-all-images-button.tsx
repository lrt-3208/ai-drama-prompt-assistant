"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ImageRef {
  asset_id: string | null;
  name: string;
  shot_number?: number;
}

interface CopyAllImagesButtonProps {
  characters: ImageRef[];
  locations: ImageRef[];
  shots: ImageRef[];
  /** asset_id → 公共 URL 映射（由服务端构造，公共读桶无需签名） */
  assetUrls?: Record<string, string>;
}

/**
 * "复制全部图片"按钮
 *
 * 行为：将当前 Scene 视频生成需要的所有图片 URL 按格式复制
 * 格式：
 *   [角色参考]
 *   url1
 *
 *   [场景参考]
 *   url2
 *
 *   [镜头序列]
 *   url3
 *   url4
 *   url5
 */
export function CopyAllImagesButton({
  characters,
  locations,
  shots,
  assetUrls = {},
}: CopyAllImagesButtonProps) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    setCopying(true);

    try {
      // 直接从 assetUrls map 获取公共 URL，无需请求
      const getUrl = (assetId: string | null) =>
        assetId ? assetUrls[assetId] : undefined;

      const sections: string[] = [];

      // 角色参考
      const charUrls = characters
        .map((c) => getUrl(c.asset_id))
        .filter((u): u is string => !!u);
      if (charUrls.length > 0) {
        sections.push(`[角色参考]\n${charUrls.join("\n")}`);
      }

      // 场景参考
      const locUrls = locations
        .map((l) => getUrl(l.asset_id))
        .filter((u): u is string => !!u);
      if (locUrls.length > 0) {
        sections.push(`[场景参考]\n${locUrls.join("\n")}`);
      }

      // 镜头序列
      const shotUrls = shots
        .map((s) => getUrl(s.asset_id))
        .filter((u): u is string => !!u);
      if (shotUrls.length > 0) {
        sections.push(`[镜头序列]\n${shotUrls.join("\n")}`);
      }

      if (sections.length === 0) {
        toast.error("没有可复制的图片");
        return;
      }

      const text = sections.join("\n\n");

      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`已复制 ${charUrls.length + locUrls.length + shotUrls.length} 张图片 URL`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    } finally {
      setCopying(false);
    }
  };

  const hasImages =
    characters.some((c) => c.asset_id) ||
    locations.some((l) => l.asset_id) ||
    shots.some((s) => s.asset_id);

  if (!hasImages) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleCopy}
      disabled={copying || copied}
    >
      {copying ? "复制中..." : copied ? "已复制" : "复制全部图片"}
    </Button>
  );
}
