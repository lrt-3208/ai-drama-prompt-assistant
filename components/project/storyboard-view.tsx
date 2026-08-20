"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useStoryboardTaskPolling, type StoryboardTask } from "@/hooks/use-storyboard-task-polling";
import { Collapse, CollapseTrigger, CollapseContent } from "@/components/ui/collapse";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Shot {
  id: string;
  shot_number: number;
  description: string | null;
  action: string | null;
  emotion: string | null;
  environment: string | null;
  cinematography: string | null;
  dialogue: string | null;
}

interface Scene {
  id: string;
  scene_number: number;
  location_name: string | null;
  time: string | null;
  weather: string | null;
  shots: Shot[];
}

interface Episode {
  id: string;
  episode_number: number;
  title: string | null;
  summary: string | null;
  status: string | null;
  /** 剧情大纲（判「依赖缺失」态：无 plot_outline = 整集置灰不可用） */
  plot_outline?: { summary?: string } | null;
  plot_version?: number | null;
  plot_updated_at?: string | null;
  plot_change_summary?: string | null;
  /** 分镜大纲（判「未就绪」态：有剧情无大纲 = 引导去剧本 Tab 补齐） */
  shot_outline?: { scenes?: unknown[] } | null;
  outline_version?: number | null;
  /** 分镜内容版本号（原型 05 头部展示「分镜 vN」） */
  storyboard_version?: number | null;
  storyboard_updated_at?: string | null;
  /** 依赖快照条用：分镜内容生成时依据的分镜大纲版本 */
  storyboard_based_on_outline_version?: number | null;
  scenes: Scene[];
}

interface PromptRef {
  shot_id: string;
  prompt_type: string;
}

interface StoryboardRef {
  scene_id: string;
  is_stale: boolean;
  stale_reason: string | null;
  status: string;
}

export function StoryboardView({
  projectId,
  initial,
  prompts,
  initialTasks,
  storyboards,
}: {
  projectId: string;
  initial: Episode[] | null;
  prompts: PromptRef[] | null;
  initialTasks?: StoryboardTask[] | null;
  storyboards?: StoryboardRef[] | null;
}) {
  const router = useRouter();
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmEpisode, setConfirmEpisode] = useState<number | null>(null);
  const [staleBannerDismissed, setStaleBannerDismissed] = useState(false);

  const { isEpisodeGenerating, isFullGenerating, isBusy, createEpisodeTask } = useStoryboardTaskPolling({
    projectId,
    initialTasks: initialTasks ?? [],
    onTaskDone: (episodeNumber, taskType, status) => {
      if (taskType === "generate_storyboard") {
        if (status === "success") toast.success("全量分镜生成成功");
        else toast.error("全量分镜生成失败");
      } else if (taskType === "generate_storyboard_episode") {
        if (status === "success") toast.success(`第 ${episodeNumber} 集分镜生成成功`);
        else toast.error(`第 ${episodeNumber} 集分镜生成失败`);
      }
      router.refresh();
    },
  });

  // 构建 shot_id → prompt 状态映射（只追踪 image，video 已改为场景级）
  const promptStatusMap = new Map<string, { image: boolean }>();
  if (prompts) {
    for (const p of prompts) {
      if (!p.shot_id) continue;
      const existing = promptStatusMap.get(p.shot_id) || { image: false };
      if (p.prompt_type === "image") existing.image = true;
      promptStatusMap.set(p.shot_id, existing);
    }
  }

  // 构建 scene_id → storyboard 状态映射
  const storyboardMap = new Map<string, StoryboardRef>();
  if (storyboards) {
    for (const sb of storyboards) {
      storyboardMap.set(sb.scene_id, sb);
    }
  }

  const eps = initial || [];

  // 检查某集是否有 prompts（通过 shot_id 关联到该集的 shots）
  const episodeHasPrompts = (episodeNumber: number) => {
    const ep = eps.find((e) => e.episode_number === episodeNumber);
    if (!ep) return false;
    const shotIds = new Set(
      ep.scenes?.flatMap((sc) => sc.shots?.map((sh) => sh.id) ?? []) ?? []
    );
    return prompts?.some((p) => p.shot_id && shotIds.has(p.shot_id)) ?? false;
  };

  /** 单集过期信息：场景级 stale + 上游脏（分镜大纲已升级） */
  const getStaleInfo = (ep: Episode) => {
    const staleScenes = (ep.scenes || []).filter(
      (sc) => storyboardMap.get(sc.id)?.is_stale
    );
    const upstreamDirty =
      ep.storyboard_based_on_outline_version != null &&
      ep.outline_version != null &&
      ep.storyboard_based_on_outline_version < ep.outline_version;
    return {
      staleScenes,
      upstreamDirty,
      isStale: staleScenes.length > 0 || upstreamDirty,
    };
  };

  /** 是否已有分镜内容 */
  const hasStoryboard = (ep: Episode) => (ep.scenes?.length ?? 0) > 0;

  /** 综合过期判定：场景级 stale / 上游脏 / 旧链路依赖不全（有分镜但缺剧情或分镜大纲） */
  const isEpisodeStale = (ep: Episode) => {
    if (!hasStoryboard(ep)) return false;
    const { staleScenes, upstreamDirty } = getStaleInfo(ep);
    return (
      staleScenes.length > 0 ||
      upstreamDirty ||
      !ep.plot_outline ||
      (ep.shot_outline?.scenes?.length ?? 0) === 0
    );
  };

  // 统计：已生成 / 过期
  const generatedCount = eps.filter((ep) => hasStoryboard(ep)).length;
  const staleEps = eps.filter(isEpisodeStale);
  const staleCount = staleEps.length;

  // 实际执行单集生成
  const doGenerateEpisode = async (episodeNumber: number) => {
    setConfirmEpisode(null);
    toast.info(`AI 生成第 ${episodeNumber} 集分镜中，通常需要 30-60 秒...`);
    try {
      await createEpisodeTask(episodeNumber);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // 单集重新生成（带确认）
  const handleGenerateEpisode = (episodeNumber: number) => {
    if (episodeHasPrompts(episodeNumber)) {
      setConfirmEpisode(episodeNumber);
    } else {
      doGenerateEpisode(episodeNumber);
    }
  };

  // 批量重新生成全部过期集（逐集创建任务）
  const doRegenerateStale = async () => {
    setConfirmAll(false);
    if (staleEps.length === 0) return;
    toast.info(`正在为 ${staleEps.length} 个过期集创建重新生成任务...`);
    try {
      for (const ep of staleEps) {
        await createEpisodeTask(ep.episode_number);
      }
      setStaleBannerDismissed(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // 空状态：Episode 骨架由项目初始化创建
  if (eps.length === 0) {
    return (
      <div className="max-w-6xl">
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-1">分镜工作台</h2>
          <p className="text-xs text-muted-foreground">
            每集一个 Collapse · 依赖 Episode 剧情大纲与分镜大纲
          </p>
        </div>
        <div className="bg-card border border-dashed border-border rounded-xl py-12 flex flex-col items-center gap-3">
          <span className="text-2xl opacity-25">🎬</span>
          <p className="text-xs text-muted-foreground">
            还没有 Episode 骨架 —— 项目初始化时会按集数范围自动创建
          </p>
          <Link
            href={`/projects/${projectId}/script`}
            className="text-xs text-primary underline decoration-primary/40 hover:decoration-primary"
          >
            前往剧本 Tab →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      {/* 头部（原型 05：统计 + 批量重生成过期集按钮） */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold mb-1">分镜工作台</h2>
          <p className="text-xs text-muted-foreground">
            每集一个 Collapse · 依赖{" "}
            <code className="text-muted-foreground/80 bg-surface2 px-1.5 py-0.5 rounded">
              Episode 剧情版本
            </code>
            <span className="mx-1.5 text-border">|</span>
            已生成 <span className="text-green-400">{generatedCount}</span> 集
            {staleCount > 0 && (
              <>
                {" "}· <span className="text-stale">{staleCount} 集过期</span>
              </>
            )}
          </p>
        </div>
        {staleCount > 0 && (
          <button
            onClick={() => setConfirmAll(true)}
            disabled={isBusy || isFullGenerating()}
            className="px-3.5 py-2 rounded-lg bg-stale/15 border border-stale/40 text-stale text-xs hover:bg-stale/25 transition disabled:opacity-40"
          >
            ⟳ 重新生成全部过期集（{staleCount}）
          </button>
        )}
      </div>

      {/* 全量任务进行中提示 */}
      {isFullGenerating() && (
        <div className="mb-6 bg-primary/8 border border-primary/25 rounded-xl px-5 py-3 flex items-center gap-3">
          <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-xs text-primary animate-pulse">
            全量分镜生成任务进行中，完成后自动刷新…
          </span>
        </div>
      )}

      {/* 过期汇总卡（原型 05） */}
      {staleCount > 0 && !staleBannerDismissed && (
        <div className="mb-6 bg-stale/8 border border-stale/30 rounded-xl p-4 flex gap-3 glow-stale">
          <span className="text-stale text-lg leading-none mt-0.5">⚠</span>
          <div className="flex-1">
            <div className="text-sm text-stale font-medium mb-1.5">
              检测到 {staleCount} 集分镜内容已过期
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              <span className="text-foreground/80">
                {staleEps.map((e) => `第 ${e.episode_number} 集`).join("、")}
              </span>{" "}
              的上游依赖已变更，当前分镜内容仍基于旧版本生成，两者内容可能已不一致。
              <br />
              建议点击对应集的<span className="text-stale">「重新生成」</span>按钮，或使用右上角批量重新生成。
            </div>
          </div>
          <button
            onClick={() => setStaleBannerDismissed(true)}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground self-start"
          >
            忽略
          </button>
        </div>
      )}

      {eps.map((ep, epIdx) => {
        const fullGenerating = isFullGenerating();
        const epBusy =
          isEpisodeGenerating(ep.episode_number) ||
          ep.status === "generating" ||
          fullGenerating ||
          isBusy;
        // 原型 EP5：生成中（任务轮询或 DB 乐观锁状态）
        const epGenerating =
          isEpisodeGenerating(ep.episode_number) || ep.status === "generating";

        // 原型 EP5：生成中 —— primary 边框 + spinner + pulse，不可展开
        if (epGenerating) {
          return (
            <div
              key={ep.id}
              className="mb-3 bg-card border border-primary/40 rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <span className="inline-block w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-primary text-sm mb-0.5">
                    {ep.title || `第 ${ep.episode_number} 集`}
                  </h3>
                  <p className="text-xs text-muted-foreground animate-pulse">
                    正在生成分镜…
                  </p>
                </div>
                <span className="text-[10px] px-2 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 shrink-0">
                  生成中
                </span>
              </div>
            </div>
          );
        }

        const hasPlot = !!ep.plot_outline;
        const hasOutline = (ep.shot_outline?.scenes?.length ?? 0) > 0;

        // 原型 EP4：依赖缺失（剧情大纲未生成、且无分镜内容）—— 整集置灰不可展开
        if (!hasPlot && !hasStoryboard(ep)) {
          return (
            <div
              key={ep.id}
              className="mb-3 bg-card/50 border border-border rounded-xl overflow-hidden opacity-60"
            >
              <div className="px-5 py-4 flex items-center gap-3">
                <span className="text-muted-foreground/40 text-xs">▼</span>
                <span className="w-9 h-9 rounded-lg bg-surface2 border border-border text-muted-foreground/50 text-xs font-bold flex items-center justify-center shrink-0">
                  {String(ep.episode_number).padStart(2, "0")}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-medium text-muted-foreground/70 text-sm">
                      {ep.title || `第 ${ep.episode_number} 集`}
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground/60">
                    剧本剧情大纲未生成 · 分镜不可用
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] px-2 py-1 rounded-full bg-surface2 text-muted-foreground/60 border border-border">
                    依赖缺失
                  </span>
                  <button
                    disabled
                    className="px-3 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground/50 text-[11px] cursor-not-allowed"
                  >
                    生成分镜
                  </button>
                </div>
              </div>
            </div>
          );
        }

        // 原型 EP3：未就绪（有剧情、无分镜内容；分镜大纲有无决定能否直接生成）
        if (!hasStoryboard(ep)) {
          const canGenerate = hasOutline;
          return (
            <div key={ep.id} className="mb-3 bg-card border border-border rounded-xl overflow-hidden">
              <Collapse defaultOpen={false}>
                <div className="flex items-center justify-between px-5 py-4 hover:bg-surface2/50 transition-colors">
                  <CollapseTrigger className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="w-9 h-9 rounded-lg bg-surface2 border border-border text-muted-foreground text-xs font-bold flex items-center justify-center shrink-0">
                      {String(ep.episode_number).padStart(2, "0")}
                    </span>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <h3 className="font-medium text-foreground text-sm">
                          {ep.title || `第 ${ep.episode_number} 集`}
                        </h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border">
                          分镜未生成
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        剧情 <span className="font-mono">v{ep.plot_version ?? 1}</span> 已就绪
                        {!canGenerate && (
                          <>
                            {" "}· <span className="text-stale">分镜大纲未生成，需先补齐</span>
                          </>
                        )}
                        {canGenerate && (
                          <>
                            {" "}· <span className="text-green-400">分镜大纲已就绪，可生成分镜内容</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="text-[10px] px-2 py-1 rounded-full bg-surface2 text-muted-foreground border border-border shrink-0">
                      未就绪
                    </span>
                  </CollapseTrigger>
                </div>
                <CollapseContent className="border-t border-border">
                  <div className="p-5">
                    <div className="bg-surface2/50 border border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3">
                      <span className="text-2xl opacity-25">🎬</span>
                      <p className="text-xs text-muted-foreground text-center max-w-md leading-relaxed">
                        {canGenerate ? (
                          <>
                            本集
                            <span className="text-foreground/80">剧情大纲与分镜大纲均已就绪</span>
                            ，可以生成分镜内容。
                          </>
                        ) : (
                          <>
                            本集<span className="text-foreground/80">剧情大纲已就绪</span>，但
                            <span className="text-stale">分镜大纲尚未生成</span>。
                            <br />
                            分镜生成需要同时依赖「剧情大纲 + 分镜大纲」两者，请先到剧本 Tab 补齐分镜大纲。
                          </>
                        )}
                      </p>
                      <div className="flex gap-2 mt-1 flex-wrap justify-center">
                        {canGenerate ? (
                          <button
                            onClick={() => handleGenerateEpisode(ep.episode_number)}
                            disabled={epBusy}
                            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition disabled:opacity-40"
                          >
                            生成分镜
                          </button>
                        ) : (
                          <>
                            <Link
                              href={`/projects/${projectId}/script`}
                              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition"
                            >
                              前往剧本生成分镜大纲
                            </Link>
                            <button
                              disabled
                              className="px-4 py-2 rounded-lg bg-surface2 border border-border text-muted-foreground/60 text-xs cursor-not-allowed"
                            >
                              生成分镜（需先补齐依赖）
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </CollapseContent>
              </Collapse>
            </div>
          );
        }

        // ===== 已有分镜内容：已就绪（EP1）/ 已过期（EP2）=====
        const { staleScenes, upstreamDirty } = getStaleInfo(ep);
        // 旧链路数据（依赖反转 bug 产物）：分镜已存在但剧情/分镜大纲缺失 → 按过期语义引导补依赖
        const missingDeps = !hasPlot || !hasOutline;
        const isStale = isEpisodeStale(ep);
        const epShotCount = (ep.scenes || []).reduce(
          (acc, sc) => acc + (sc.shots?.length || 0),
          0
        );
        const sbVersion = ep.storyboard_version ?? 1;
        const basedOnOutlineVersion = ep.storyboard_based_on_outline_version ?? ep.outline_version ?? 1;
        // 分镜内容重建过 → 下游画面指令需同步（原型 05 的紫色 ⓘ 提醒条）
        const needsDownstreamSync = sbVersion > 1;
        const plotChanged = !!ep.plot_change_summary;

        return (
          <div
            key={ep.id}
            className={`mb-3 bg-card rounded-xl overflow-hidden ${
              isStale ? "border-2 border-stale glow-stale" : "border border-border"
            }`}
          >
            {/* 需要关注的集（过期 / 下游待同步）默认展开，与原型 05 一致 */}
            <Collapse defaultOpen={epIdx === 0 || isStale || needsDownstreamSync}>
              <div
                className={`flex items-center justify-between px-5 py-4 transition-colors ${
                  isStale ? "bg-stale/5 hover:bg-stale/10" : "hover:bg-surface2/50"
                }`}
              >
                <CollapseTrigger className="flex items-center gap-3 flex-1 min-w-0">
                  <span
                    className={`w-9 h-9 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                      isStale
                        ? "bg-stale/20 text-stale"
                        : "bg-green-500/15 text-green-400"
                    }`}
                  >
                    {String(ep.episode_number).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      {ep.title && (
                        <span className="font-medium text-foreground text-sm">{ep.title}</span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border font-mono">
                        分镜 v{sbVersion}
                      </span>
                      {isStale && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-stale/20 text-stale border border-stale/40">
                          ⚠ 依赖已变更
                        </span>
                      )}
                    </div>
                    {isStale ? (
                      <p className="text-xs text-stale">
                        {ep.scenes?.length || 0} 场景 · {epShotCount} 镜头 ·{" "}
                        {upstreamDirty ? (
                          <>
                            依赖分镜大纲 <span className="font-mono">v{basedOnOutlineVersion}</span>，当前已是{" "}
                            <span className="font-mono">v{ep.outline_version}</span>
                          </>
                        ) : missingDeps ? (
                          "分镜生成时依赖不全（旧链路数据），建议补齐依赖后重新生成"
                        ) : (
                          "上游依赖已变更，内容可能与最新版本不一致"
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {ep.scenes?.length || 0} 场景 · {epShotCount} 镜头 · 依赖剧情{" "}
                        <span className="font-mono">v{ep.plot_version ?? 1}</span>
                        <span className="text-green-500">（最新）</span>
                        {ep.storyboard_updated_at && (
                          <>
                            {" "}·{" "}
                            {new Date(ep.storyboard_updated_at).toLocaleDateString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                            })}{" "}
                            生成
                          </>
                        )}
                      </p>
                    )}
                  </div>
                </CollapseTrigger>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[10px] px-2 py-1 rounded-full ${
                      isStale
                        ? "bg-stale/20 text-stale border border-stale/40"
                        : "bg-green-500/15 text-green-400 border border-green-500/30"
                    }`}
                  >
                    {isStale ? "已过期" : "已就绪"}
                  </span>
                  <button
                    onClick={() => handleGenerateEpisode(ep.episode_number)}
                    disabled={epBusy}
                    className={`px-3 py-1.5 rounded-lg text-[11px] transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      isStale
                        ? "bg-stale text-stale-foreground font-semibold hover:bg-stale/90"
                        : "bg-surface2 border border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
                    }`}
                  >
                    ⟳ 重新生成
                  </button>
                </div>
              </div>
              <CollapseContent className={isStale ? "border-t-2 border-stale/40" : "border-t border-border"}>
                {/* 过期变更提示条（原型 05 EP2：精确说明哪个依赖、何时改的、改了什么） */}
                {isStale && (
                  <div className="bg-stale/10 border-b border-stale/30 px-5 py-4">
                    <div className="flex gap-3">
                      <span className="text-stale text-xl leading-none mt-0.5">⚠</span>
                      <div className="flex-1">
                        <div className="text-sm text-stale font-semibold mb-2">
                          本集分镜依赖已变更，建议点击「重新生成」同步分镜内容
                        </div>
                        <div className="bg-background/60 rounded-lg p-3.5 space-y-2 text-xs">
                          {missingDeps && (
                            <div className="flex items-start gap-2.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-stale/20 text-stale font-mono shrink-0 mt-px">
                                依赖缺失
                              </span>
                              <div className="text-muted-foreground leading-relaxed">
                                <span className="text-foreground/80">本集分镜生成时依赖不全</span>
                                （旧链路数据）：{!hasPlot && "剧情大纲未生成"}
                                {!hasPlot && !hasOutline && "、"}
                                {!hasOutline && "分镜大纲未生成"}
                                ，请先在剧本 Tab 补齐后再重新生成分镜
                              </div>
                            </div>
                          )}
                          {plotChanged && (
                            <div className="flex items-start gap-2.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-stale/20 text-stale font-mono shrink-0 mt-px">
                                剧情
                              </span>
                              <div className="text-muted-foreground leading-relaxed">
                                <span className="text-foreground/80">剧情大纲</span>
                                {ep.plot_updated_at &&
                                  ` 于 ${new Date(ep.plot_updated_at).toLocaleString("zh-CN")} 被修改：`}
                                {ep.plot_change_summary}
                              </div>
                            </div>
                          )}
                          {upstreamDirty && (
                            <div className="flex items-start gap-2.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-stale/15 text-stale font-mono shrink-0 mt-px">
                                上游脏
                              </span>
                              <div className="text-muted-foreground leading-relaxed">
                                <span className="text-foreground/80">分镜大纲</span> 已从{" "}
                                <span className="font-mono">v{basedOnOutlineVersion}</span> 升级到{" "}
                                <span className="font-mono text-stale">v{ep.outline_version}</span>，
                                当前分镜内容仍基于旧大纲生成
                              </div>
                            </div>
                          )}
                          {staleScenes.slice(0, 3).map((sc) => {
                            const sb = storyboardMap.get(sc.id);
                            return (
                              <div key={sc.id} className="flex items-start gap-2.5">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-stale/15 text-stale font-mono shrink-0 mt-px">
                                  S{sc.scene_number}
                                </span>
                                <div className="text-muted-foreground leading-relaxed">
                                  <span className="text-foreground/80">Storyboard 依赖已变更</span>：
                                  {sb?.stale_reason || "资产已修改"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-2.5 leading-relaxed">
                          ▸ 当前分镜内容不包含最新依赖细节，直接用于画面指令生成会导致画面与剧情脱节。
                          <br />▸{" "}
                          <span className="text-stale">建议顺序</span>：① 剧本 Tab 重新生成分镜大纲
                          → ② 回本页重新生成分镜内容 → ③ 画面指令 Tab 重新生成。
                        </div>
                        <div className="flex gap-2 mt-3.5 flex-wrap">
                          <Link
                            href={`/projects/${projectId}/script`}
                            className="px-4 py-2 rounded-lg bg-stale text-stale-foreground text-[11px] font-semibold hover:bg-stale/90 transition"
                          >
                            ① 先去重新生成分镜大纲
                          </Link>
                          <button
                            onClick={() => handleGenerateEpisode(ep.episode_number)}
                            disabled={epBusy}
                            className="px-4 py-2 rounded-lg bg-surface2 border border-stale/40 text-stale text-[11px] hover:bg-stale/10 transition disabled:opacity-40"
                          >
                            仅重新生成分镜内容
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 下游提醒：本集分镜刚重新生成，画面指令需同步（原型 05 紫色 ⓘ 条） */}
                {needsDownstreamSync && !isStale && (
                  <div className="bg-primary/8 border-b border-primary/25 px-5 py-3 flex gap-3">
                    <span className="text-primary text-base leading-none mt-0.5">ⓘ</span>
                    <div className="text-xs flex-1">
                      <div className="text-primary font-medium mb-0.5">
                        本集分镜已重新生成（分镜 v{sbVersion}），下游画面指令需同步
                        {ep.storyboard_updated_at &&
                          ` · ${new Date(ep.storyboard_updated_at).toLocaleString("zh-CN")}`}
                      </div>
                      <div className="text-muted-foreground leading-relaxed">
                        分镜内容重建后，原有镜头与画面指令已随之失效。
                        <Link
                          href={`/projects/${projectId}/prompts`}
                          className="text-primary underline decoration-primary/40 hover:decoration-primary ml-1"
                        >
                          前往画面指令 Tab 重新生成 →
                        </Link>
                      </div>
                    </div>
                  </div>
                )}

                {/* 依赖快照条（原型 05：剧情大纲 / 分镜大纲版本比对） */}
                <div className="bg-surface2/40 border-b border-border px-5 py-3 flex items-center gap-5 flex-wrap text-[11px]">
                  <span className="text-muted-foreground/60">依赖快照：</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="text-muted-foreground">剧情大纲</span>
                    <span className="font-mono text-muted-foreground/80">
                      v{ep.plot_version ?? 1}
                    </span>
                    <span className="text-muted-foreground/60">
                      = 当前 <span className="font-mono">v{ep.plot_version ?? 1}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5" title="分镜内容生成时依据的分镜大纲版本">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        upstreamDirty ? "bg-stale" : "bg-green-500"
                      }`}
                    />
                    <span className="text-muted-foreground">分镜大纲</span>
                    <span className="font-mono text-muted-foreground/80">
                      v{basedOnOutlineVersion}
                    </span>
                    {upstreamDirty ? (
                      <span className="text-muted-foreground/60">
                        ≠ 当前 <span className="font-mono text-stale">v{ep.outline_version}</span>
                        <span className="text-stale">（上游脏）</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">
                        = 当前 <span className="font-mono">v{ep.outline_version ?? 1}</span>
                      </span>
                    )}
                  </span>
                  {ep.storyboard_updated_at && (
                    <span className="text-muted-foreground/60 ml-auto">
                      生成于 {new Date(ep.storyboard_updated_at).toLocaleString("zh-CN")}
                    </span>
                  )}
                </div>

                <div className="px-5 py-4">
                  {ep.summary && (
                    <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{ep.summary}</p>
                  )}

                  {ep.scenes?.map((sc) => {
                    const sb = storyboardMap.get(sc.id);
                    const scStale = !!sb?.is_stale;
                    return (
                      <div
                        key={sc.id}
                        className={`mb-2 last:mb-0 bg-surface2 rounded-lg overflow-hidden ${
                          scStale ? "border-2 border-stale/50" : "border border-border"
                        }`}
                      >
                        <div className="px-4 py-2.5 flex items-center gap-2.5 flex-wrap border-b border-border">
                          <span
                            className={`w-6 h-6 rounded text-[10px] font-medium flex items-center justify-center shrink-0 ${
                              scStale ? "bg-stale/20 text-stale" : "bg-primary/15 text-primary"
                            }`}
                          >
                            S{sc.scene_number}
                          </span>
                          {sc.location_name && (
                            <span className="text-xs text-foreground">{sc.location_name}</span>
                          )}
                          {sc.time && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-muted-foreground">
                              {sc.time}
                            </span>
                          )}
                          {sc.weather && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-muted-foreground">
                              {sc.weather}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {sc.shots?.length || 0} 镜
                          </span>
                          {scStale && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stale/15 text-stale border border-stale/30 ml-auto">
                              内容可能已过时
                            </span>
                          )}
                        </div>

                        <div className="px-3 py-2.5 space-y-1.5">
                          {sc.shots?.map((sh) => {
                            const ps = promptStatusMap.get(sh.id) || { image: false };
                            return (
                              <div
                                key={sh.id}
                                className="bg-background/60 border border-border rounded-lg px-3 py-2"
                              >
                                <div className="flex items-center gap-2.5 mb-1">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono shrink-0">
                                    {String(sh.shot_number).padStart(2, "0")}
                                  </span>
                                  {sh.cinematography && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      {sh.cinematography}
                                    </span>
                                  )}
                                  {sh.description && (
                                    <p className="text-[11px] text-foreground truncate flex-1 min-w-0">
                                      {sh.description}
                                    </p>
                                  )}
                                  <span
                                    className={`text-[10px] shrink-0 ${
                                      ps.image ? "text-green-400" : "text-muted-foreground/60"
                                    }`}
                                    title={ps.image ? "已生成 Image Prompt" : "未生成 Image Prompt"}
                                  >
                                    {ps.image ? "🖼 ✓" : "🖼 ✗"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground pl-1">
                                  {sh.environment && <span>环境: {sh.environment}</span>}
                                  {sh.action && <span>动作: {sh.action}</span>}
                                  {sh.emotion && <span>情绪: {sh.emotion}</span>}
                                </div>
                                {sh.dialogue && (
                                  <p className="text-[10px] mt-1 ml-1 italic text-muted-foreground border-l-2 border-primary/30 pl-2">
                                    &ldquo;{sh.dialogue}&rdquo;
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapseContent>
            </Collapse>
          </div>
        );
      })}

      {/* 批量重生成过期集确认弹窗 */}
      <ConfirmDialog
        open={confirmAll}
        onConfirm={doRegenerateStale}
        onCancel={() => setConfirmAll(false)}
        title={staleCount > 0 ? `确认重新生成 ${staleCount} 个过期集` : ""}
        description="将删除这些过期集的场景、镜头、镜头 Prompt、故事板和场景视频 Prompt，并基于最新依赖重新生成，且不可恢复。确定继续？"
        confirmText="确认重新生成"
        variant="destructive"
      />

      {/* 单集重新生成确认弹窗 */}
      <ConfirmDialog
        open={confirmEpisode !== null}
        onConfirm={() => confirmEpisode !== null && doGenerateEpisode(confirmEpisode)}
        onCancel={() => setConfirmEpisode(null)}
        title={confirmEpisode !== null ? `确认重新生成第 ${confirmEpisode} 集` : ""}
        description="重新生成将删除该集所有场景、镜头、镜头 Prompt、故事板和场景视频 Prompt，且不可恢复。确定继续？"
        confirmText="确认重新生成"
        variant="destructive"
      />
    </div>
  );
}
