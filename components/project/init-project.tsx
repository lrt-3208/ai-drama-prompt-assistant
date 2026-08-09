"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type InitMode = "auto" | "retry" | "loading";

const STEP_LABELS: Record<string, string> = {
  story: "分析故事",
  characters: "生成角色",
  locations: "生成场景",
  style: "生成风格",
};

function StepStatus({
  stepKey,
  status,
}: {
  stepKey: string;
  status?: string;
}) {
  const label = STEP_LABELS[stepKey] || stepKey;

  if (status === "success") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-green-500 font-bold">✓</span>
        <span className="text-foreground">{label}</span>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-red-500 font-bold">✗</span>
        <span className="text-red-500">{label}</span>
      </div>
    );
  }
  if (status === "running" || status === "waking_up") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-primary">{label}...</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="inline-block h-3 w-3 rounded-full border-2 border-muted-foreground border-t-transparent" />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

export function InitProject({
  projectId,
  mode,
  taskId: serverTaskId,
  taskStatus: serverTaskStatus,
  assetProgress,
  assetError,
  assetStatus,
}: {
  projectId: string;
  mode: InitMode;
  taskId?: string | null;
  taskStatus?: string | null;
  assetProgress?: Record<string, string> | null;
  assetError?: Record<string, string> | null;
  assetStatus?: string;
}) {
  const router = useRouter();
  const [taskId, setTaskId] = useState<string | null>(serverTaskId || null);
  const [progress, setProgress] = useState<Record<string, string>>(
    assetProgress || {}
  );
  const [taskStatus, setTaskStatus] = useState<string | null>(
    serverTaskStatus || null
  );
  const [resetting, setResetting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initCalledRef = useRef(false);

  // auto 模式：创建任务
  useEffect(() => {
    if (mode === "auto" && !taskId && !initCalledRef.current) {
      initCalledRef.current = true;
      fetch(`/api/projects/${projectId}/initialize`, { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.taskId) {
            setTaskId(data.taskId);
            setTaskStatus(data.status || "pending");
            if (data.progress) setProgress(data.progress);
          } else if (data.error && data.status !== 409) {
            toast.error(data.error);
          } else if (data.taskId === null && data.assetStatus === "initialized") {
            // 已经初始化过了
            router.refresh();
          }
        })
        .catch(() => toast.error("网络错误"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, projectId]);

  // loading 模式 + pending 状态 → 调 wakeup 恢复执行
  useEffect(() => {
    if (mode === "loading" && taskId && taskStatus === "pending") {
      fetch(`/api/projects/${projectId}/initialize/wakeup`, { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.taskId) setTaskStatus("waking_up");
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, taskId, taskStatus, projectId]);

  // 轮询（3s 固定间隔，最大 5 分钟超时）
  useEffect(() => {
    if (!taskId) return;
    if (!["pending", "waking_up", "running"].includes(taskStatus || "")) return;

    const startTime = Date.now();
    const MAX_DURATION = 5 * 60 * 1000; // 5 分钟

    const interval = setInterval(async () => {
      // 超时检查
      if (Date.now() - startTime > MAX_DURATION) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setTaskStatus("failed");
        toast.error("初始化超时（5 分钟），请刷新重试或检查 AI 模型配置");
        setTimeout(() => router.refresh(), 800);
        return;
      }

      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        const data = await res.json();
        setProgress(data.progress || {});
        setTaskStatus(data.status);

        if (["success", "partial", "failed"].includes(data.status)) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          const okCount = Object.values(data.progress || {}).filter(
            (s: unknown) => s === "success"
          ).length;
          if (data.status === "success") {
            toast.success("项目资产初始化完成！");
          } else if (data.status === "partial") {
            toast.warning(`部分资产生成成功（${okCount}/4）`);
          } else {
            toast.error("初始化失败，请重试");
          }
          setTimeout(() => router.refresh(), 800);
        }
      } catch {
        // 忽略网络错误，继续轮询
      }
    }, 3000);

    intervalRef.current = interval;
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [taskId, taskStatus, router]);

  // 强制重置
  const handleForceReset = useCallback(async () => {
    if (!confirm("强制重置将中断当前初始化状态，已生成的资产会保留。确认继续？")) return;
    setResetting(true);
    try {
      await fetch(`/api/projects/${projectId}/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      toast.success("已重置，可以重新初始化");
      router.refresh();
    } catch {
      toast.error("网络错误");
    } finally {
      setResetting(false);
    }
  }, [projectId, router]);

  // 重试
  const handleRetry = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/initialize`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.taskId) {
      setTaskId(data.taskId);
      setTaskStatus("pending");
      setProgress({});
    } else if (data.status === 409 && data.taskId) {
      // 已有活跃任务
      setTaskId(data.taskId);
      setTaskStatus(data.status || "pending");
      setProgress(data.progress || {});
    } else {
      toast.error(data.error || "创建任务失败");
    }
  }, [projectId]);

  // loading 模式（任务正在执行）
  if (mode === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {taskStatus === "pending" ? "任务等待执行" : "初始化进行中"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            AI 正在生成资产，进度如下。刷新页面不会中断任务。
          </p>
          <div className="flex flex-col gap-2">
            {Object.keys(STEP_LABELS).map((key) => (
              <div key={key} className="flex flex-col gap-1">
                <StepStatus stepKey={key} status={progress[key]} />
                {assetError?.[key] && progress[key] === "failed" && (
                  <span className="text-xs text-red-500 ml-5">
                    {assetError[key]}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.refresh()}
            >
              刷新查看进度
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleForceReset}
              disabled={resetting}
            >
              {resetting ? "重置中..." : "强制重置"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // retry 模式（失败后重试）
  if (mode === "retry") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {assetStatus === "partial"
              ? "部分资产未生成成功"
              : "项目初始化失败"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {assetStatus === "partial" && (
            <p className="text-sm text-muted-foreground">
              部分资产已生成成功，但有些步骤失败了。你可以重新初始化，或手动在各页面补充内容。
            </p>
          )}
          {assetStatus === "failed" && (
            <p className="text-sm text-muted-foreground">
              初始化失败，请重试。如果持续失败，请检查网络或稍后再试。
            </p>
          )}

          {assetProgress && Object.keys(assetProgress).length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              {Object.keys(STEP_LABELS).map((key) => (
                <div key={key} className="flex flex-col gap-1">
                  <StepStatus stepKey={key} status={assetProgress[key]} />
                  {assetError?.[key] && (
                    <span className="text-xs text-red-500 ml-5">
                      {assetError[key]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <Button onClick={handleRetry} size="sm">
              重新初始化
            </Button>
            {assetStatus === "partial" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/projects/${projectId}/characters`)}
              >
                查看已生成内容
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // auto 模式（创建中）
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">正在初始化项目资产</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          AI 正在根据你的故事创意生成基础资产（故事分析、角色、场景、风格）...
        </p>
        <div className="flex flex-col gap-2">
          {Object.keys(STEP_LABELS).map((key) => (
            <StepStatus key={key} stepKey={key} status={progress[key] || "pending"} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
