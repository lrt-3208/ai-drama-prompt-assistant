"use client";

import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-xl font-semibold">出错了</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {error.message || "页面加载时发生未知错误"}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            错误代码: {error.digest}
          </p>
        )}
        <Button onClick={reset} variant="outline">
          重试
        </Button>
      </div>
    </div>
  );
}
