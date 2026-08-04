"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface ActiveTask {
  id: string;
  status: string;
  progress: Record<string, string>;
  task_type: string;
}

interface UseTaskPollingOptions {
  projectId: string;
  initialTask?: ActiveTask | null;
  onDone?: (status: string, progress: Record<string, string>) => void;
}

/**
 * 共享任务轮询 hook
 *
 * 替换组件中 useState(false) 的 loading 模式：
 * - 任务状态持久化在 DB，刷新页面不丢失
 * - pending → 自动调 wakeup 恢复
 * - running → 3s 轮询
 * - 完成 → 调 onDone 回调
 *
 * 用法：
 * const { isGenerating, createTask, taskStatus, progress } = useTaskPolling({
 *   projectId,
 *   initialTask: activeTask,
 *   onDone: (status) => router.refresh(),
 * });
 */
export function useTaskPolling({
  projectId,
  initialTask,
  onDone,
}: UseTaskPollingOptions) {
  const [taskId, setTaskId] = useState<string | null>(initialTask?.id ?? null);
  const [taskStatus, setTaskStatus] = useState<string | null>(
    initialTask?.status ?? null
  );
  const [progress, setProgress] = useState<Record<string, string>>(
    initialTask?.progress ?? {}
  );

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // pending → 调 wakeup 恢复（服务端 fire-and-forget）
  useEffect(() => {
    if (taskId && taskStatus === "pending") {
      fetch(`/api/projects/${projectId}/initialize/wakeup`, {
        method: "POST",
      }).catch(() => {});
    }
  }, [taskId, taskStatus, projectId]);

  // 3s 轮询
  useEffect(() => {
    if (!taskId || !["pending", "running"].includes(taskStatus ?? "")) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) return;
        const data = await res.json();
        setProgress(data.progress ?? {});
        setTaskStatus(data.status);

        if (["success", "partial", "failed"].includes(data.status)) {
          clearInterval(interval);
          onDoneRef.current?.(data.status, data.progress ?? {});
        }
      } catch {
        // 网络错误忽略，下次轮询重试
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [taskId, taskStatus]);

  // 创建新任务
  const createTask = useCallback(
    async (taskType: string, payload?: Record<string, unknown>) => {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType, payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "创建任务失败");
      }
      if (data.taskId) {
        setTaskId(data.taskId);
        setTaskStatus("pending");
        setProgress({});
      }
      return data;
    },
    [projectId]
  );

  const isGenerating = ["pending", "running"].includes(taskStatus ?? "");

  return { taskId, taskStatus, progress, isGenerating, createTask };
}
