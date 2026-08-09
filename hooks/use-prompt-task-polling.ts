"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface PromptTask {
  id: string;
  status: string;
  task_type: string;
  payload: {
    shotId?: string;
    sceneId?: string;
    promptId?: string;
    promptType?: "image" | "video";
    platform?: string;
    language?: string;
  };
}

interface UsePromptTaskPollingOptions {
  projectId: string;
  initialTasks: PromptTask[];
  onTaskDone?: (entityId: string, taskType: string, status: string) => void;
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
 * - 使用 tasksRef 镜像同步读取最新任务列表（避免 React 18 自动批处理导致 setTasks updater 延迟）
 */
export function usePromptTaskPolling({
  projectId,
  initialTasks,
  onTaskDone,
}: UsePromptTaskPollingOptions) {
  const [tasks, setTasks] = useState<PromptTask[]>(initialTasks);

  // tasks 的 ref 镜像，供 tick 内部同步读取最新值
  // 避免 React 18 自动批处理导致 setTasks updater 延迟执行的问题
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

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

        // 构建 ID → task 映射（含 status + task_type + payload）
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

        // 从 API 响应直接判断是否需要继续轮询
        const hasActiveInResponse = (data.active || []).some(
          (t: { status: string }) => ACTIVE_STATUSES.includes(t.status)
        );

        // ✅ 关键修复：在 setTasks 之外、直接从 tasksRef + API 响应同步计算已完成任务
        // React 18 自动批处理导致 setTasks 的 functional updater 延迟到 render 阶段执行，
        // 在 updater 内部填充 newlyCompleted 数组是不可靠的（紧跟其后的代码读到的是空数组）
        const currentTasks = tasksRef.current;
        const completedTaskIds = new Set<string>();
        const newlyCompleted: { entityId: string; taskType: string; status: string }[] = [];

        for (const task of currentTasks) {
          if (!ACTIVE_STATUSES.includes(task.status)) continue;
          if (doneSetRef.current.has(task.id)) continue;

          const completedTask = completedMap.get(task.id);
          const activeTask = activeTasksMap.get(task.id);

          // 任务可能出现在 recentlyCompleted 中，也可能在 active 中但状态已是终态
          const terminalStatus =
            (completedTask && TERMINAL_STATUSES.includes(completedTask.status)) ? completedTask.status :
            (activeTask && TERMINAL_STATUSES.includes(activeTask.status)) ? activeTask.status :
            null;

          if (terminalStatus) {
            doneSetRef.current.add(task.id);
            completedTaskIds.add(task.id);
            newlyCompleted.push({
              entityId: task.payload.shotId || task.payload.sceneId || task.payload.promptId || "",
              taskType: task.task_type,
              status: terminalStatus,
            });
          }
        }

        // 更新 tasks 状态（纯数据操作，无副作用）
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

          // 补充从 API 发现的新任务（不在 prev 中的活跃任务）
          for (const [id, t] of activeTasksMap) {
            if (!knownIds.has(id) && ACTIVE_STATUSES.includes(t.status)) {
              updated.push({
                id,
                status: t.status,
                task_type: t.task_type,
                payload: t.payload as PromptTask["payload"],
              });
            }
          }

          return updated;
        });

        // ✅ 安全触发 onDone 回调（newlyCompleted 已同步填充）
        for (const c of newlyCompleted) {
          onTaskDoneRef.current?.(c.entityId, c.taskType, c.status);
        }

        // 决定是否继续轮询：API 有活跃任务 OR 本地仍有未完成任务（安全网）
        // 安全网场景：任务刚创建、API 查询时序差异等导致 API 响应暂未包含该任务
        const hasLocalActiveTask = currentTasks.some(
          (t) => ACTIVE_STATUSES.includes(t.status) && !completedTaskIds.has(t.id) && !doneSetRef.current.has(t.id)
        );
        if ((hasActiveInResponse || hasLocalActiveTask) && !cancelled) {
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

  // 创建新的 prompt 任务（镜头级）
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
            task_type: "generate_prompt",
            payload: { shotId, promptType, platform, language },
          },
        ]);
      }

      return data;
    },
    [projectId]
  );

  // 创建场景级任务（Storyboard / 场景视频 Prompt）
  const createSceneTask = useCallback(
    async (
      taskType: "generate_storyboard_asset" | "generate_scene_video_prompt",
      sceneId: string,
      extra?: Record<string, unknown>
    ) => {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType,
          payload: { sceneId, ...extra },
        }),
      });
      const data = await res.json();

      // 409 冲突：同场景已有任务在执行中
      // 将已有任务加入本地状态以跟踪进度（避免 UI 无感知）
      if (res.status === 409 && data.taskId) {
        setTasks((prev) => {
          if (prev.some((t) => t.id === data.taskId)) return prev;
          return [
            ...prev,
            {
              id: data.taskId,
              status: data.status || "pending",
              task_type: data.taskType || taskType,
              payload: { sceneId, platform: "", language: "", ...extra },
            },
          ];
        });
        throw new Error(data.error || "该场景已有任务在执行中");
      }

      if (!res.ok) {
        throw new Error(data.error || "创建任务失败");
      }

      if (data.taskId) {
        setTasks((prev) => [
          ...prev,
          {
            id: data.taskId,
            status: "pending",
            task_type: taskType,
            payload: { sceneId, platform: "", language: "", ...extra },
          },
        ]);
      }

      return data;
    },
    [projectId]
  );

  // 创建 Prompt 质量评分任务
  const createPromptEvalTask = useCallback(
    async (promptId: string) => {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "evaluate_prompt",
          payload: { promptId },
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
            task_type: "evaluate_prompt",
            payload: { promptId, platform: "", language: "" },
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

  // 检查指定场景的任务是否正在生成
  const isSceneGenerating = useCallback(
    (sceneId: string, taskType: string) => {
      return tasks.some(
        (t) =>
          t.payload.sceneId === sceneId &&
          t.task_type === taskType &&
          ACTIVE_STATUSES.includes(t.status)
      );
    },
    [tasks]
  );

  // 检查指定 Prompt 是否正在评分
  const isPromptEvaluating = useCallback(
    (promptId: string) => {
      return tasks.some(
        (t) =>
          t.payload.promptId === promptId &&
          t.task_type === "evaluate_prompt" &&
          ACTIVE_STATUSES.includes(t.status)
      );
    },
    [tasks]
  );

  return {
    tasks,
    isShotGenerating,
    isSceneGenerating,
    isPromptEvaluating,
    createPromptTask,
    createSceneTask,
    createPromptEvalTask,
  };
}
