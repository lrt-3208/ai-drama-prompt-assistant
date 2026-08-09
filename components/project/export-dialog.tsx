"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ExportDialogProps {
  projectId: string;
  trigger?: React.ReactNode;
}

export function ExportDialog({ projectId, trigger }: ExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<"json" | "markdown" | "text">("markdown");

  const handleExport = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/export?format=${format}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导出失败");
      setContent(data.content || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    toast.success("已复制到剪贴板");
  };

  const handleDownload = () => {
    if (!content) return;
    const ext = format === "json" ? "json" : format === "markdown" ? "md" : "txt";
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prompts_export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium h-8 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground">
        {trigger || "导出 Prompt"}
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>导出 Prompt</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 mb-3">
          {(["markdown", "json", "text"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={format === f ? "default" : "outline"}
              onClick={() => setFormat(f)}
            >
              {f === "markdown" ? "Markdown" : f === "json" ? "JSON" : "Text"}
            </Button>
          ))}
          <Button size="sm" onClick={handleExport} disabled={loading}>
            {loading ? "导出中..." : "导出"}
          </Button>
        </div>
        {content && (
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" variant="outline" onClick={handleCopy}>
              复制
            </Button>
            <Button size="sm" variant="outline" onClick={handleDownload}>
              下载
            </Button>
          </div>
        )}
        {content && (
          <div className="bg-muted/30 rounded-lg p-3 max-h-[50vh] overflow-auto">
            <pre className="text-xs whitespace-pre-wrap font-mono">{content}</pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
