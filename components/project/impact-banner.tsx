"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RegenConfirm } from "@/components/project/regen-confirm";

interface StaleItem {
  id: string;
  label: string;
  reason: string;
  level: "shot" | "scene";
}

interface ImpactBannerProps {
  projectId: string;
  stalePromptCount: number;
  staleStoryboardCount: number;
  staleItems?: StaleItem[];
}

/**
 * 全局影响提示条
 * 显示过期 Prompt/Storyboard 数量，提供增量重生成确认入口
 */
export function ImpactBanner({
  projectId,
  stalePromptCount,
  staleStoryboardCount,
  staleItems = [],
}: ImpactBannerProps) {
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  const totalStale = stalePromptCount + staleStoryboardCount;

  if (totalStale === 0) return null;

  return (
    <>
      <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-4 mb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                资产已修改，部分内容需要更新
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                {stalePromptCount > 0 && `${stalePromptCount} 个 Prompt `}
                {staleStoryboardCount > 0 && `、 ${staleStoryboardCount} 个 Storyboard `}
                已过期
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="default"
            onClick={() => setShowRegenConfirm(true)}
          >
            查看详情并重生成
          </Button>
        </div>
      </div>

      <RegenConfirm
        projectId={projectId}
        open={showRegenConfirm}
        onOpenChange={setShowRegenConfirm}
        staleItems={staleItems}
      />
    </>
  );
}
