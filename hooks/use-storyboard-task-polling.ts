"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

export interface StoryboardTask {
  id: string;
  status: string;
  task_type: string;
  payload: {
    episodeNumber?: number;
  };
}

interface UseStoryboardTaskPollingOptions {
  projectId: string;
  initialTasks: StoryboardTask[];
  onTaskDone?: (episodeNumber: number | null, taskType: string, status: string) => void;
}

const TERMINAL_STATUSES = ["success", "partial", "failed"];
const ACTIVE_STATUSES = ["pending", "running"];
const MAX_POLL_DURATION = 5 * 60 * 1000;

/**
 * 多任务并发轮询 hook（专为分镜生成设计）
 *
 * 支持：
 * - 多集分镜同时生成（generate_storyboard_episode）
 * - 全量分镜生成（generate_storyboard）
 * - 按 episodeNumber 精确查询某集是否在生成
 * - 单次 GET /tasks/active 批量查询所有任务状态
 */
export function useStoryboardTaskPolling({
  projectId,
  initialTasks,
  onTaskDone,
}: UseStoryboardTaskPollingOptions) {
  const [tasks, setTasks] = useState<StoryboardTask[]>(initialTasks);

  // tasks 的 ref 镜像，供 tick 内部同步读取最新值
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const onTaskDoneRef = useRef(onTaskDone);
  useEffect(() => {
    onTaskDoneRef.current = onTaskDone;
  }, [onTaskDone]);

  // 已触发过 onDone 的任务 ID
  const doneSetRef = useRef<Set<string>>(new Set());

  const hasActiveTask = tasks.some((t) => ACTIVE_STATUSES.includes(t.status));

  // 自适应轮询
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

      // 超时检查
      if (Date.now() - startTime > MAX_POLL_DURATION) {
        setTasks((prev) => prev.map((t) => ACTIVE_STATUSES.includes(t.status) ? { ...t, status: "failed" } : t));
        toast.error("任务执行超时（5 分钟），请刷新页面重试");
        return;
      }

      try {
        const res = await fetch(`/api/projects/${projectId}/tasks/active`);
        if (!res.ok) {
          if (!cancelled) timeoutId = setTimeout(tick, getDelay());
          return;
        }
        const data = await res.json();

        const activeMap = new Map<string, string>();
        const activeTasksMap = new Map<string, { status: string; task_type: string; payload: Record<string, unknown> }>();
        for (const t of data.active || []) {
          activeMap.set(t.id, t.status);
          activeTasksMap.set(t.id, t);
        }
        const completedMap = new Map<string, { status: string; task_type: string; payload: Record<string, unknown> }>();
        for (const t of data.recentlyCompleted || []) {
          completedMap.set(t.id, t);
        }

        const hasActiveInResponse = (data.active || []).some(
          (t: { status: string }) => ACTIVE_STATUSES.includes(t.status)
        );

        // 同步计算已完成任务
        const currentTasks = tasksRef.current;
        const completedTaskIds = new Set<string>();
        const newlyCompleted: { episodeNumber: number | null; taskType: string; status: string }[] = [];

        for (const task of currentTasks) {
          if (!ACTIVE_STATUSES.includes(task.status)) continue;
          if (doneSetRef.current.has(task.id)) continue;

          const completedTask = completedMap.get(task.id);
          const activeTask = activeTasksMap.get(task.id);

          const terminalStatus =
            (completedTask && TERMINAL_STATUSES.includes(completedTask.status)) ? completedTask.status :
            (activeTask && TERMINAL_STATUSES.includes(activeTask.status)) ? activeTask.status :
            null;

          if (terminalStatus) {
            doneSetRef.current.add(task.id);
            completedTaskIds.add(task.id);
            newlyCompleted.push({
              episodeNumber: task.payload.episodeNumber ?? null,
              taskType: task.task_type,
              status: terminalStatus,
            });
          }
        }

        // 更新 tasks 状态
        setTasks((prev) => {
          const knownIds = new Set(prev.map((t) => t.id));
          const updated = prev
            .filter((t) => !completedTaskIds.has(t.id))
            .map((t) => {
              const newStatus = activeMap.get(t.id);
              if (newStatus && newStatus !== t.status && ACTIVE_STATUSES.includes(newStatus)) {
                return { ...t, status: newStatus };
              }
              return t;
            });

          // 补充从 API 发现的新任务
          for (const [id, t] of activeTasksMap) {
            if (!knownIds.has(id) && ACTIVE_STATUSES.includes(t.status)) {
              const epNum = t.payload?.episodeNumber;
              updated.push({
                id,
                status: t.status,
                task_type: t.task_type,
                payload: { episodeNumber: typeof epNum === "number" ? epNum : undefined },
              });
            }
          }

          return updated;
        });

        // 触发 onDone 回调
        for (const c of newlyCompleted) {
          onTaskDoneRef.current?.(c.episodeNumber, c.taskType, c.status);
        }

        // 决定是否继续轮询
        const hasLocalActiveTask = currentTasks.some(
          (t) => ACTIVE_STATUSES.includes(t.status) && !completedTaskIds.has(t.id) && !doneSetRef.current.has(t.id)
        );
        if ((hasActiveInResponse || hasLocalActiveTask) && !cancelled) {
          timeoutId = setTimeout(tick, getDelay());
        }
      } catch {
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

  // 创建全量分镜任务
  const createStoryboardTask = useCallback(
    async () => {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: "generate_storyboard" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "创建任务失败");
      }
      if (data.taskId) {
        setTasks((prev) => [
          ...prev,
          { id: data.taskId, status: "pending", task_type: "generate_storyboard", payload: {} },
        ]);
      }
      return data;
    },
    [projectId]
  );

  // 创建单集分镜任务
  const createEpisodeTask = useCallback(
    async (episodeNumber: number) => {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "generate_storyboard_episode",
          payload: { episodeNumber },
        }),
      });
      const data = await res.json();

      // 409 冲突：该集已有任务在执行中
      if (res.status === 409 && data.taskId) {
        setTasks((prev) => {
          if (prev.some((t) => t.id === data.taskId)) return prev;
          return [
            ...prev,
            {
              id: data.taskId,
              status: data.status || "pending",
              task_type: data.taskType || "generate_storyboard_episode",
              payload: { episodeNumber },
            },
          ];
        });
        throw new Error(data.error || "该集正在生成中");
      }

      if (!res.ok) {
        throw new Error(data.error || "创建任务失败");
      }
      if (data.taskId) {
        setTasks((prev) => [
          ...prev,
          { id: data.taskId, status: "pending", task_type: "generate_storyboard_episode", payload: { episodeNumber } },
        ]);
      }
      return data;
    },
    [projectId]
  );

  // 检查指定集是否正在生成
  const isEpisodeGenerating = useCallback(
    (episodeNumber: number) => {
      return tasks.some(
        (t) =>
          t.payload.episodeNumber === episodeNumber &&
          t.task_type === "generate_storyboard_episode" &&
          ACTIVE_STATUSES.includes(t.status)
      );
    },
    [tasks]
  );

  // 检查全量分镜是否正在生成
  const isFullGenerating = useCallback(
    () => {
      return tasks.some(
        (t) =>
          t.task_type === "generate_storyboard" &&
          ACTIVE_STATUSES.includes(t.status)
      );
    },
    [tasks]
  );

  // 是否有任意任务在执行
  const isBusy = tasks.some((t) => ACTIVE_STATUSES.includes(t.status));

  return {
    tasks,
    isEpisodeGenerating,
    isFullGenerating,
    isBusy,
    createStoryboardTask,
    createEpisodeTask,
  };
}
