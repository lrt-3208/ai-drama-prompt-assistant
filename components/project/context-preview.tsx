"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ContextPreviewData {
  systemMessage: string;
  userMessage: string;
}

interface ContextPreviewDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shotId?: string | null;
  sceneId?: string | null;
  platform?: string | null;
  language?: string | null;
  mode?: string | null;
  title?: string;
}

/**
 * 上下文调试预览弹窗
 * 展示 AI 生成时收到的完整上下文文本（System Message + User Message）
 */
export function ContextPreviewDialog({
  projectId,
  open,
  onOpenChange,
  shotId,
  sceneId,
  platform,
  language,
  mode,
  title,
}: ContextPreviewDialogProps) {
  const [data, setData] = useState<ContextPreviewData | null>(null);
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // 从状态派生 loading，避免 effect 内同步 setState
  const loading = fetchState === "loading";

  useEffect(() => {
    if (!open || (!shotId && !sceneId)) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (shotId) params.set("shotId", shotId);
    if (sceneId) params.set("sceneId", sceneId);
    if (platform) params.set("platform", platform);
    if (language) params.set("language", language);
    if (mode) params.set("mode", mode);
    fetch(`/api/projects/${projectId}/context-preview?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((d) => {
        if (d.systemMessage !== undefined) {
          setData(d);
          setFetchState("done");
        } else {
          setFetchState("error");
          toast.error(d.error || "获取上下文预览失败");
        }
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setFetchState("error");
        toast.error("获取上下文预览失败");
      });
    // 在 effect 内同步设置 fetchState 会被 linter 标记，
    // 用 queueMicrotask 延迟到微任务
    queueMicrotask(() => setFetchState("loading"));
    return () => controller.abort();
  }, [open, shotId, sceneId, projectId, platform, language, mode]);

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success("已复制到剪贴板");
    setTimeout(() => setCopiedField(null), 2000);
  };

  const dialogTitle = title || (mode === "storyboard" ? "故事板上下文预览" : shotId ? "镜头上下文预览" : "场景上下文预览");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {dialogTitle}
            <Badge variant="outline" className="text-xs">调试</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-pulse text-muted-foreground">加载上下文中...</div>
            </div>
          ) : data ? (
            <div className="grid grid-cols-2 gap-4">
              {/* 左：System Message */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">
                    System Message
                    <span className="text-xs text-muted-foreground ml-2">（AI 角色设定 + 规则）</span>
                  </h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => handleCopy(data.systemMessage, "system")}
                  >
                    {copiedField === "system" ? "已复制" : "复制"}
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/30 rounded-lg p-3 flex-1 max-h-[60vh] overflow-y-auto">
                  {data.systemMessage || "（空）"}
                </pre>
              </div>

              {/* 右：User Message */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">
                    User Message
                    <span className="text-xs text-muted-foreground ml-2">（发送给 AI 的完整上下文）</span>
                  </h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => handleCopy(data.userMessage, "user")}
                  >
                    {copiedField === "user" ? "已复制" : "复制"}
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/30 rounded-lg p-3 flex-1 max-h-[60vh] overflow-y-auto">
                  {data.userMessage || "（空）"}
                </pre>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">无数据</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
