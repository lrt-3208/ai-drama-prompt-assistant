"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface PromptTask {
  id: string;
  status: string;
  payload: {
    shotId: string;
    promptType: "image" | "video";
    platform: string;
    language: string;
  };
}

interface UsePromptTaskPollingOptions {
  projectId: string;
  initialTasks: PromptTask[];
  onTaskDone?: (shotId: string, promptType: string, status: string) => void;
}

const TERMINAL_STATUSES = ["success", "partial", "failed"];
const ACTIVE_STATUSES = ["pending", "running"];

/**
 * 多任务并发轮询 hook（专为 Prompt 工作台设计）
 *
 * 优化点：
 * - 单次 GET /tasks/active 批量查询所有任务状态（1 请求替代 N 请求）
 * - 自适应轮询间隔：3s → 5s(30s后) → 8s(60s后)
 * - 无活跃任务时自动停止轮询
 * - 新任务创建时重置为 3s 快速轮询
 * - 使用 setTasks 函数式更新，无需 tasks ref（避免 stale closure）
 */
export function usePromptTaskPolling({
  projectId,
  initialTasks,
  onTaskDone,
}: UsePromptTaskPollingOptions) {
  const [tasks, setTasks] = useState<PromptTask[]>(initialTasks);

  const onTaskDoneRef = useRef(onTaskDone);
  useEffect(() => {
    onTaskDoneRef.current = onTaskDone;
  }, [onTaskDone]);

  // 已触发过 onDone 的任务 ID（避免重复回调）
  const doneSetRef = useRef<Set<string>>(new Set());

  // 是否有活跃任务（控制轮询启停）
  const hasActiveTask = tasks.some((t) => ACTIVE_STATUSES.includes(t.status));

  // 轮询：单请求批量查询 + 自适应间隔
  useEffect(() => {
    if (!hasActiveTask) return;

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

      try {
        const res = await fetch(`/api/projects/${projectId}/tasks/active`);
        if (!res.ok) {
          if (!cancelled) timeoutId = setTimeout(tick, getDelay());
          return;
        }
        const data = await res.json();

        // 构建 ID → status 映射
        const activeMap = new Map<string, string>();
        for (const t of data.active || []) {
          activeMap.set(t.id, t.status);
        }
        const completedMap = new Map<string, string>();
        for (const t of data.recentlyCompleted || []) {
          completedMap.set(t.id, t.status);
        }

        // 从 API 响应直接判断是否需要继续轮询
        // 注意：不能用 setTasks updater 内部的副作用来设置 shouldContinue，
        // 因为 React 18 自动批处理导致 updater 在 render 阶段才执行，不是同步的
        const hasActiveInResponse = (data.active || []).some(
          (t: { status: string }) => ACTIVE_STATUSES.includes(t.status)
        );

        // 函数式更新：处理完成的任务，更新活跃任务状态
        setTasks((prev) => {
          const completedIds = new Set<string>();

          for (const task of prev) {
            if (!ACTIVE_STATUSES.includes(task.status)) continue;

            // 在 recentlyCompleted 中 → 触发 onDone
            const completedStatus = completedMap.get(task.id);
            const activeStatus = activeMap.get(task.id);

            if (completedStatus && TERMINAL_STATUSES.includes(completedStatus)) {
              if (!doneSetRef.current.has(task.id)) {
                doneSetRef.current.add(task.id);
                completedIds.add(task.id);
                onTaskDoneRef.current?.(
                  task.payload.shotId,
                  task.payload.promptType,
                  completedStatus
                );
              }
            } else if (activeStatus && TERMINAL_STATUSES.includes(activeStatus)) {
              // 在 active 中但状态已变为终态
              if (!doneSetRef.current.has(task.id)) {
                doneSetRef.current.add(task.id);
                completedIds.add(task.id);
                onTaskDoneRef.current?.(
                  task.payload.shotId,
                  task.payload.promptType,
                  activeStatus
                );
              }
            }
          }

          return prev
            .filter((t) => !completedIds.has(t.id))
            .map((t) => {
              const newStatus = activeMap.get(t.id);
              if (newStatus && newStatus !== t.status && ACTIVE_STATUSES.includes(newStatus)) {
                return { ...t, status: newStatus };
              }
              return t;
            });
        });

        // 从 API 响应直接决定是否继续轮询
        if (hasActiveInResponse && !cancelled) {
          timeoutId = setTimeout(tick, getDelay());
        }
      } catch {
        // 网络错误 → 继续轮询
        if (!cancelled) {
          timeoutId = setTimeout(tick, getDelay());
        }
      }
    };

    timeoutId = setTimeout(tick, getDelay());

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [hasActiveTask, projectId]);

  // 初始 pending 任务 → 调 wakeup 恢复
  useEffect(() => {
    const pending = initialTasks.filter((t) => t.status === "pending");
    if (pending.length > 0) {
      fetch(`/api/projects/${projectId}/initialize/wakeup`, {
        method: "POST",
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 创建新的 prompt 任务
  const createPromptTask = useCallback(
    async (
      shotId: string,
      promptType: "image" | "video",
      platform: string,
      language: string
    ) => {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "generate_prompt",
          payload: { shotId, promptType, platform, language },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "创建任务失败");
      }

      if (data.taskId) {
        setTasks((prev) => [
          ...prev,
          {
            id: data.taskId,
            status: "pending",
            payload: { shotId, promptType, platform, language },
          },
        ]);
      }

      return data;
    },
    [projectId]
  );

  // 检查指定镜头+类型是否正在生成
  const isShotGenerating = useCallback(
    (shotId: string, promptType: "image" | "video") => {
      return tasks.some(
        (t) =>
          t.payload.shotId === shotId &&
          t.payload.promptType === promptType &&
          ACTIVE_STATUSES.includes(t.status)
      );
    },
    [tasks]
  );

  return { tasks, isShotGenerating, createPromptTask };
}
