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

/**
 * 多任务并发轮询 hook（专为 Prompt 工作台设计）
 *
 * 与 useTaskPolling 的区别：
 * - 支持同一时间多个 generate_prompt 任务并发
 * - 按镜头+类型粒度跟踪加载状态
 * - 单个 3s interval 轮询所有活跃任务
 */
export function usePromptTaskPolling({
  projectId,
  initialTasks,
  onTaskDone,
}: UsePromptTaskPollingOptions) {
  const [tasks, setTasks] = useState<PromptTask[]>(initialTasks);

  // ref 镜像，interval 读取 ref 避免依赖循环
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const onTaskDoneRef = useRef(onTaskDone);
  useEffect(() => {
    onTaskDoneRef.current = onTaskDone;
  }, [onTaskDone]);

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

  // 单个 interval 轮询所有活跃任务
  useEffect(() => {
    const interval = setInterval(async () => {
      const activeTasks = tasksRef.current.filter((t) =>
        ["pending", "running"].includes(t.status)
      );
      if (activeTasks.length === 0) return;

      const completedIds = new Set<string>();
      const statusUpdates = new Map<string, string>();

      for (const task of activeTasks) {
        try {
          const res = await fetch(`/api/tasks/${task.id}`);
          if (!res.ok) continue;
          const data = await res.json();

          if (data.status !== task.status) {
            if (["success", "partial", "failed"].includes(data.status)) {
              completedIds.add(task.id);
              onTaskDoneRef.current?.(
                task.payload.shotId,
                task.payload.promptType,
                data.status
              );
            } else {
              statusUpdates.set(task.id, data.status);
            }
          }
        } catch {
          // 网络错误忽略
        }
      }

      if (completedIds.size > 0 || statusUpdates.size > 0) {
        setTasks((prev) =>
          prev
            .filter((t) => !completedIds.has(t.id))
            .map((t) =>
              statusUpdates.has(t.id)
                ? { ...t, status: statusUpdates.get(t.id)! }
                : t
            )
        );
      }
    }, 3000);

    return () => clearInterval(interval);
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
          ["pending", "running"].includes(t.status)
      );
    },
    [tasks]
  );

  return { tasks, isShotGenerating, createPromptTask };
}
