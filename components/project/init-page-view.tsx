"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ============================================
// 项目初始化页（独立页面 /init/[id]）
// 严格对照原型 prototype-v2/02-init.html：
//   项目卡（风格 icon + chips + 状态徽章）/ 总进度 / 5 步四态列表
//   / 失败态错误卡 / 完成态统计 + 下一步指引 + 跳过二次确认
// ============================================

type InitMode = "auto" | "loading" | "retry" | "done";

interface StepDef {
  key: string;
  label: string;
  desc: string;
}

/** 风格头图映射（按 visual_styles.name 关键字匹配 4 预置风格） */
function styleBadge(styleName: string | null): { icon: string; gradient: string } {
  const n = styleName ?? "";
  if (n.includes("日漫")) return { icon: "🌸", gradient: "from-pink-400 via-rose-500 to-purple-700" };
  if (n.includes("国漫")) return { icon: "🏮", gradient: "from-red-500 via-orange-600 to-amber-800" };
  if (n.includes("漫画")) return { icon: "📖", gradient: "from-gray-200 via-gray-400 to-gray-700" };
  return { icon: "🎥", gradient: "from-slate-600 to-slate-900" };
}

const MODE_LABELS: Record<string, string> = {
  continuous: "连续剧情",
  episodic: "单元剧",
  mixed: "混合",
};

export function InitPageView({
  projectId,
  projectName,
  genre,
  serializationMode,
  styleName,
  mode,
  taskId: serverTaskId,
  taskStatus: serverTaskStatus,
  initialProgress,
  assetError,
  stats,
}: {
  projectId: string;
  projectName: string;
  genre: string | null;
  serializationMode: string;
  styleName: string | null;
  mode: InitMode;
  taskId?: string | null;
  taskStatus?: string | null;
  initialProgress: Record<string, string>;
  assetError?: Record<string, string> | null;
  stats: { characters: number; locations: number; episodes: number; episodeSkeletons: number };
}) {
  const router = useRouter();
  const [taskId, setTaskId] = useState<string | null>(serverTaskId || null);
  const [progress, setProgress] = useState<Record<string, string>>(initialProgress || {});
  const [taskStatus, setTaskStatus] = useState<string | null>(serverTaskStatus || null);
  const [retrying, setRetrying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showSkipWarn, setShowSkipWarn] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initCalledRef = useRef(false);

  const badge = styleBadge(styleName);
  const skeletonCount = stats.episodeSkeletons;

  // 步骤定义（展示顺序对照原型 02-init：故事→风格→角色→场景→骨架）
  const steps: StepDef[] = [
    { key: "story", label: "故事分析", desc: "提取主题、核心冲突、目标情绪、世界观" },
    {
      key: "style",
      label: "风格配置",
      desc: styleName
        ? `基于「${styleName}」模板生成 fixed_prompt + negative_prompt`
        : "生成 fixed_prompt + negative_prompt",
    },
    { key: "characters", label: "角色库", desc: "生成角色 · 含外貌 / 性格 / 背景 / fixed_prompt" },
    { key: "locations", label: "场景库", desc: "生成场景 · 含环境 / 时间 / 天气 / fixed_prompt" },
    {
      key: "episodes",
      label: "Episode 骨架列表",
      desc: `创建 ${skeletonCount} 集空壳记录（仅集号 + 占位标题，无剧情）`,
    },
  ];

  // 整体状态派生
  const done = mode === "done";
  const hasFailure = steps.some((s) => progress[s.key] === "failed" || assetError?.[s.key]);
  const successCount = steps.filter((s) =>
    done ? true : progress[s.key] === "success"
  ).length;

  // done 态各步骤的展示文案（对照原型 02-init done 态：带实际数量 + Episode 骨架专属文案）
  const doneDescMap: Record<string, React.ReactNode> = {
    characters: `生成 ${stats.characters} 个角色 · 含外貌 / 性格 / 背景 / fixed_prompt`,
    locations: `生成 ${stats.locations} 个场景 · 含环境 / 时间 / 天气 / fixed_prompt`,
    episodes: (
      <>
        已创建 {skeletonCount} 集空壳 ·{" "}
        <span className="text-stale">剧情大纲留空，待逐集生成</span>
      </>
    ),
  };

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
  }, [mode, taskId, taskStatus, projectId]);

  // 轮询（3s 固定间隔，最大 5 分钟超时）
  useEffect(() => {
    if (done || !taskId) return;
    if (!["pending", "waking_up", "running"].includes(taskStatus || "")) return;

    const startTime = Date.now();
    const MAX_DURATION = 5 * 60 * 1000;

    const interval = setInterval(async () => {
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
          if (data.status === "success") {
            toast.success("项目初始化完成！");
          } else if (data.status === "partial") {
            toast.warning("部分步骤生成成功，可重试");
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
  }, [taskId, taskStatus, done, router]);

  // 重新初始化（retry / 失败态；initialize 幂等：AI 步骤 upsert 覆盖、骨架 ignoreDuplicates）
  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/initialize`, { method: "POST" });
      const data = await res.json();
      if (data.taskId) {
        setTaskId(data.taskId);
        setTaskStatus(data.status || "pending");
        setProgress(data.progress || {});
      } else {
        toast.error(data.error || "创建任务失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setRetrying(false);
    }
  }, [projectId]);

  // 强制重置（loading 态卡死时）
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

  // 头部状态徽章（对照原型三态）
  const headBadge = done
    ? { text: "初始化完成", cls: "bg-green-500/15 text-green-400 border-green-500/30" }
    : hasFailure
    ? { text: "部分失败", cls: "bg-red-500/15 text-red-400 border-red-500/30" }
    : { text: "初始化中…", cls: "bg-primary/15 text-primary border-primary/30" };

  const pct = Math.round((successCount / steps.length) * 100);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* 面包屑顶栏（对照原型） */}
      <div className="border-b border-border bg-card/60 -mx-6 px-6 mb-8">
        <div className="h-14 flex items-center gap-3">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground text-sm">
            ← 工作台
          </Link>
          <span className="text-border">/</span>
          <span className="text-sm text-foreground font-medium">项目初始化</span>
        </div>
      </div>

      {/* 项目卡片 */}
      <div className="bg-card border border-border rounded-2xl p-8 mb-6">
        {/* 头部：icon + 名称 + chips + 状态徽章 */}
        <div className="flex items-start gap-4 mb-8">
          <div
            className={`w-14 h-14 rounded-xl bg-gradient-to-br ${badge.gradient} flex items-center justify-center text-2xl shrink-0`}
          >
            {badge.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-foreground mb-1 truncate">{projectName}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              {styleName && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                  {styleName}
                </span>
              )}
              {genre && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-surface2 text-muted-foreground border border-border">
                  {genre}
                </span>
              )}
              <span className="text-[11px] px-2 py-0.5 rounded bg-surface2 text-muted-foreground border border-border">
                {MODE_LABELS[serializationMode] ?? serializationMode}
              </span>
            </div>
          </div>
          <div className={`text-xs px-3 py-1.5 rounded-full border shrink-0 ${headBadge.cls}`}>
            {headBadge.text}
          </div>
        </div>

        {/* 总进度 */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-muted-foreground">总进度</span>
            <span className="text-foreground font-medium">
              {done ? steps.length : successCount} / {steps.length}
            </span>
          </div>
          <div className="h-1.5 bg-surface2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                hasFailure && !done ? "bg-red-500" : done ? "bg-green-500" : "bg-primary"
              }`}
              style={{ width: `${done ? 100 : pct}%` }}
            />
          </div>
        </div>

        {/* 步骤列表（四态，对照原型） */}
        <div className="space-y-3">
          {steps.map((s, i) => {
            const status = done
              ? "success"
              : progress[s.key] || "pending";
            const errMsg = assetError?.[s.key];

            if (status === "success") {
              return (
                <div
                  key={s.key}
                  className="flex items-center gap-4 p-4 rounded-xl bg-surface2 border border-border"
                >
                  <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center text-green-400 shrink-0">
                    ✓
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground">{s.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {done ? (doneDescMap[s.key] ?? s.desc) : s.desc}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">已完成</div>
                </div>
              );
            }

            if (status === "failed") {
              return (
                <div
                  key={s.key}
                  className="flex items-center gap-4 p-4 rounded-xl bg-red-500/5 border border-red-500/30"
                >
                  <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center text-red-400 shrink-0">
                    ✗
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-red-400">{s.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {errMsg || "生成失败，可重新初始化"}
                    </div>
                  </div>
                  <div className="text-xs text-red-400 shrink-0">失败</div>
                </div>
              );
            }

            if (status === "running" || status === "waking_up") {
              return (
                <div
                  key={s.key}
                  className="flex items-center gap-4 p-4 rounded-xl bg-primary/5 border border-primary/30"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <span className="inline-block w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-primary">{s.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 animate-pulse">
                      正在生成…
                    </div>
                  </div>
                  <div className="text-xs text-primary shrink-0">进行中</div>
                </div>
              );
            }

            // pending（等待）— 前置失败时展示「已跳过」
            const skipped = hasFailure;
            return (
              <div
                key={s.key}
                className="flex items-center gap-4 p-4 rounded-xl bg-surface2/50 border border-border"
              >
                <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground/70 text-xs shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                  <div className="text-xs text-muted-foreground/60 mt-0.5">
                    {skipped ? "前置步骤失败，已跳过" : s.desc}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground/60 shrink-0">
                  {skipped ? "已跳过" : "等待"}
                </div>
              </div>
            );
          })}
        </div>

        {/* 失败态错误信息（对照原型 errBox） */}
        {!done && hasFailure && (
          <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <div className="flex gap-3">
              <span className="text-red-400 text-lg leading-none mt-0.5">✗</span>
              <div className="flex-1">
                <div className="text-sm text-red-400 font-medium mb-1">
                  {steps.filter((s) => progress[s.key] === "failed" || assetError?.[s.key]).map((s) => s.label).join("、")}
                  {" "}生成失败
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed mb-3">
                  {assetError && Object.keys(assetError).length > 0
                    ? Object.entries(assetError)
                        .map(([k, v]) => `${steps.find((s) => s.key === k)?.label ?? k}: ${v}`)
                        .join("；")
                    : "初始化未全部完成，可重新初始化（已生成的资产会被覆盖更新）。"}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetry}
                  disabled={retrying}
                  className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                >
                  {retrying ? "重试中..." : "重新初始化"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* retry 模式（无活跃任务但 asset_status 异常）的重试入口 */}
        {mode === "retry" && !hasFailure && (
          <div className="mt-6 flex items-center gap-3">
            <Button size="sm" onClick={handleRetry} disabled={retrying}>
              {retrying ? "重试中..." : "重新初始化"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleForceReset} disabled={resetting}>
              {resetting ? "重置中..." : "强制重置"}
            </Button>
          </div>
        )}

        {/* loading 态操作 */}
        {mode === "loading" && (
          <div className="mt-6 flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => router.refresh()}>
              刷新查看进度
            </Button>
            <Button size="sm" variant="outline" onClick={handleForceReset} disabled={resetting}>
              {resetting ? "重置中..." : "强制重置"}
            </Button>
          </div>
        )}

        {/* 完成态（对照原型 doneBox） */}
        {done && (
          <div className="mt-8 pt-6 border-t border-border">
            <div className="bg-green-500/10 border border-green-500/25 rounded-xl p-5 mb-5">
              <div className="flex gap-3">
                <span className="text-green-400 text-lg leading-none mt-0.5">✓</span>
                <div>
                  <div className="text-sm text-green-400 font-medium mb-2">初始化完成</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <div>· {stats.characters} 个角色已入库</div>
                    <div>· {stats.locations} 个场景已入库</div>
                    <div>· 风格配置已生成{styleName ? `（${styleName}）` : ""}</div>
                    <div>· {stats.episodes} 集 Episode 骨架已创建</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-stale/10 border border-stale/30 rounded-xl p-5 mb-5">
              <div className="flex gap-3">
                <span className="text-stale text-lg leading-none mt-0.5">→</span>
                <div>
                  <div className="text-sm text-stale font-medium mb-2">下一步做什么？</div>
                  <div className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
                    <div>
                      <span className="text-foreground/80">1.</span> 现在角色 / 场景 / 风格
                      <span className="text-green-400"> 处于可编辑状态</span>
                      ，请先检查并调整满意（支持 AI 优化 + 手动编辑 + 上传参考图）
                    </div>
                    <div>
                      <span className="text-foreground/80">2.</span> 满意后到「剧本」Tab
                      逐集生成剧情大纲 + 分镜大纲
                    </div>
                    <div>
                      <span className="text-foreground/80">3.</span>{" "}
                      <span className="text-stale">一旦第一集剧情生成，角色 / 场景 / 风格将自动锁定</span>
                      ，无法再修改配置（保证视觉一致性）
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Link
                href={`/projects/${projectId}/characters`}
                className="flex-1 px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition text-center"
              >
                检查资产库 →
              </Link>
              <button
                onClick={() => setShowSkipWarn((v) => !v)}
                className="px-5 py-3 rounded-lg bg-surface2 border border-border text-muted-foreground text-sm hover:border-muted-foreground/40 transition"
              >
                {showSkipWarn ? "收起警告" : "跳过，直接去剧本"}
              </button>
            </div>

            {/* 跳过二次确认（对照原型 skipWarn，避免误锁定） */}
            {showSkipWarn && (
              <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-5">
                <div className="flex gap-3">
                  <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
                  <div className="flex-1">
                    <div className="text-sm text-red-400 font-medium mb-2">
                      确定跳过资产检查？这是不可逆的
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed mb-3">
                      一旦在剧本 Tab 生成了
                      <span className="text-foreground/80">第一集剧情大纲</span>
                      ，角色库和场景库会<span className="text-red-400">立即永久锁定</span>——
                      因为剧情文字里已经写入了角色名和场景名。
                      <br />
                      此后想改角色外貌、场景设定，
                      <span className="text-foreground/80">只能删除全部已生成剧情</span>才能解锁。
                      <br />
                      <span className="text-muted-foreground/60">
                        现在花 2 分钟检查 {stats.characters} 个角色 + {stats.locations}{" "}
                        个场景，比写了 10 集后返工划算得多。
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/projects/${projectId}/characters`}
                        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition"
                      >
                        好，先去检查资产
                      </Link>
                      <Link
                        href={`/projects/${projectId}/script`}
                        className="px-4 py-2 rounded-lg bg-surface2 border border-red-500/40 text-red-400 text-xs hover:bg-red-500/10 transition"
                      >
                        我确认跳过，直接写剧本
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 与旧架构的关键差异（对照原型 02-init 底部说明卡） */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-medium text-foreground mb-3">▸ 与旧架构的关键差异</h3>
        <div className="space-y-2.5 text-xs">
          <div className="flex gap-3">
            <span className="w-16 shrink-0 text-red-400">旧</span>
            <span className="text-muted-foreground">
              初始化 = 故事 + 角色 + 场景 + 风格，剧本需单独点「生成剧本」一次性出全部集数
            </span>
          </div>
          <div className="flex gap-3">
            <span className="w-16 shrink-0 text-primary">新</span>
            <span className="text-foreground/80">
              初始化 = 故事 + 角色 + 场景 + 风格 +{" "}
              <span className="text-primary">Episode 骨架列表</span>
              。骨架只有集号和占位标题，剧情大纲留空，进入剧本 Tab 后逐集手动生成
            </span>
          </div>
          <div className="flex gap-3 pt-2 border-t border-border">
            <span className="w-16 shrink-0 text-muted-foreground">收益</span>
            <span className="text-muted-foreground">
              ① 支持无限集连载 ② 每集独立生成质量更高 ③ 可随时追加新集 ④ 单元剧/连续剧两种模式都能支持
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
