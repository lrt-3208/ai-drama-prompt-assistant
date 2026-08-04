"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-xl font-semibold">页面加载失败</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {error.message || "发生未知错误"}
        </p>
        <div className="flex gap-2">
          <Button onClick={reset} variant="outline">
            重试
          </Button>
          <Button onClick={() => (window.location.href = "/dashboard")}>
            返回首页
          </Button>
        </div>
      </div>
    </div>
  );
}
