"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PreviewableImage } from "@/components/ui/previewable-image";

// ============================================
// 类型定义
// ============================================

interface ImageRef {
  asset_id: string | null;
  name: string;
  shot_number?: number;
}

interface ImageDependencyPanelProps {
  characters: ImageRef[];
  locations: ImageRef[];
  shots: ImageRef[];
  assetUrls?: Record<string, string>;
}

// ============================================
// 单张图片（直接使用传入的 URL）
// ============================================

function AssetImage({ url, label }: { url?: string; label: string }) {
  if (!url) {
    return (
      <div className="w-20 h-20 rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground border border-dashed">
        无图片
      </div>
    );
  }

  return (
    <div className="relative group">
      <PreviewableImage
        src={url}
        alt={label}
        className="w-20 h-20 rounded-lg object-cover border border-border"
        previewCaption={label}
      />
      <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1 py-0.5 rounded-b-lg truncate">
        {label}
      </span>
    </div>
  );
}

// ============================================
// 图片依赖面板
// ============================================

export function ImageDependencyPanel({
  characters,
  locations,
  shots,
  assetUrls = {},
}: ImageDependencyPanelProps) {
  const hasImages =
    characters.some((c) => c.asset_id) ||
    locations.some((l) => l.asset_id) ||
    shots.some((s) => s.asset_id);

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium">图片依赖</h4>
          <Badge variant="outline" className="text-xs">
            {characters.filter((c) => c.asset_id).length +
              locations.filter((l) => l.asset_id).length +
              shots.filter((s) => s.asset_id).length}{" "}
            张
          </Badge>
        </div>

        {!hasImages && (
          <p className="text-xs text-muted-foreground">暂无图片资产</p>
        )}

        {/* 角色图片 */}
        {characters.filter((c) => c.asset_id).length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1.5">角色参考</p>
            <div className="flex gap-2 flex-wrap">
              {characters
                .filter((c) => c.asset_id)
                .map((c) => (
                  <AssetImage key={c.asset_id} url={assetUrls[c.asset_id!]} label={c.name} />
                ))}
            </div>
          </div>
        )}

        {/* 场景图片 */}
        {locations.filter((l) => l.asset_id).length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1.5">场景参考</p>
            <div className="flex gap-2 flex-wrap">
              {locations
                .filter((l) => l.asset_id)
                .map((l) => (
                  <AssetImage key={l.asset_id} url={assetUrls[l.asset_id!]} label={l.name} />
                ))}
            </div>
          </div>
        )}

        {/* 镜头图片 */}
        {shots.filter((s) => s.asset_id).length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">镜头序列</p>
            <div className="flex gap-2 flex-wrap">
              {shots
                .filter((s) => s.asset_id)
                .map((s) => (
                  <AssetImage
                    key={s.asset_id}
                    url={assetUrls[s.asset_id!]}
                    label={`镜头${s.shot_number}`}
                  />
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
