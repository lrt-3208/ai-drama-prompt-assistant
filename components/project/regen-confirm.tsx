"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface StaleItem {
  id: string;
  label: string;
  reason: string;
  level: "shot" | "scene";
}

interface RegenConfirmProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staleItems: StaleItem[];
}

/**
 * 增量重生成确认弹窗
 * 区分镜头级和场景级，让用户确认后再重生成
 */
export function RegenConfirm({
  projectId,
  open,
  onOpenChange,
  staleItems,
}: RegenConfirmProps) {
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);

  const shotItems = staleItems.filter((i) => i.level === "shot");
  const sceneItems = staleItems.filter((i) => i.level === "scene");

  const handleConfirm = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "run_regen",
          payload: {},
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "创建任务失败");
      }
      toast.success("增量重生成任务已创建");
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>增量重生成确认</DialogTitle>
          <DialogDescription>
            以下内容因资产修改已过期，确认后将按顺序重新生成。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[400px] overflow-y-auto">
          {shotItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">镜头级</Badge>
                <span className="text-sm font-medium">
                  {shotItems.length} 个 Image Prompt
                </span>
              </div>
              <div className="space-y-1">
                {shotItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 text-xs text-muted-foreground"
                  >
                    <span className="text-amber-500 mt-0.5">⚠</span>
                    <div>
                      <span className="font-medium">{item.label}</span>
                      <span className="ml-1">{item.reason}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sceneItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">场景级</Badge>
                <span className="text-sm font-medium">
                  {sceneItems.length} 个场景资产
                </span>
              </div>
              <div className="space-y-1">
                {sceneItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 text-xs text-muted-foreground"
                  >
                    <span className="text-amber-500 mt-0.5">⚠</span>
                    <div>
                      <span className="font-medium">{item.label}</span>
                      <span className="ml-1">{item.reason}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
          重生成顺序：镜头级 Image Prompt → 场景级 Storyboard → 场景视频 Prompt（级联）
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={regenerating}
          >
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={regenerating}>
            {regenerating ? "创建中..." : "确认重生成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
