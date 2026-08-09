"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

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

const TERMINAL_STATUSES = ["success", "partial", "failed"];
const ACTIVE_STATUSES = ["pending", "running"];
/** 最大轮询时间 5 分钟，超时后停止并提示用户 */
const MAX_POLL_DURATION = 5 * 60 * 1000;

/**
 * 共享任务轮询 hook（单任务模式）
 *
 * 优化点：
 * - 自适应轮询间隔：3s → 5s(30s后) → 8s(60s后)
 * - 无活跃任务时不轮询
 * - 单次请求查询单个任务状态
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

  // pending → 调 wakeup 恢复
  useEffect(() => {
    if (taskId && taskStatus === "pending") {
      fetch(`/api/projects/${projectId}/initialize/wakeup`, {
        method: "POST",
      }).catch(() => {});
    }
  }, [taskId, taskStatus, projectId]);

  const isActive = taskId !== null && taskStatus !== null && ACTIVE_STATUSES.includes(taskStatus);

  // 自适应轮询
  useEffect(() => {
    if (!isActive) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const startTime = Date.now();

    const getDelay = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > 60000) return 8000;
      if (elapsed > 30000) return 5000;
      return 3000;
    };

    const tick = async () => {
      if (cancelled) return;

      // 超时检查
      if (Date.now() - startTime > MAX_POLL_DURATION) {
        setTaskStatus("failed");
        toast.error("任务执行超时（5 分钟），请刷新页面重试或检查 AI 模型配置");
        onDoneRef.current?.("timeout", {});
        return;
      }

      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) {
          if (!cancelled) timeoutId = setTimeout(tick, getDelay());
          return;
        }
        const data = await res.json();
        setProgress(data.progress ?? {});
        setTaskStatus(data.status);

        if (TERMINAL_STATUSES.includes(data.status)) {
          onDoneRef.current?.(data.status, data.progress ?? {});
          // 不再调度下一次轮询
          return;
        }
      } catch {
        // 网络错误 → 继续轮询
      }

      if (!cancelled) {
        timeoutId = setTimeout(tick, getDelay());
      }
    };

    timeoutId = setTimeout(tick, getDelay());

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isActive, taskId]);

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

  const isGenerating = taskId !== null && taskStatus !== null && ACTIVE_STATUSES.includes(taskStatus);

  return { taskId, taskStatus, progress, isGenerating, createTask };
}
