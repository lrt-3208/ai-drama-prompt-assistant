"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Collapse, CollapseTrigger, CollapseContent } from "@/components/ui/collapse";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { PlotOutline, ShotOutline } from "@/lib/models/episodes";
import type { ShotOutlineScene } from "@/lib/models/episodes";

// ============================================
// 类型
// ============================================

interface ScriptCharacter {
  name: string;
  role: string;
  description: string;
}

interface ScriptData {
  id?: string;
  synopsis: string | null;
  genre: string | null;
  characters: ScriptCharacter[] | null;
  relationships: string | null;
  worldview: string | null;
}

/** stories 表故事创意（项目初始化产出，新架构权威数据源） */
interface StoryIdea {
  raw_input: string | null;
  theme: string | null;
  genre: string | null;
  core_conflict: string | null;
  target_emotion: string | null;
}

interface EpisodeRow {
  id: string;
  episode_number: number;
  title: string | null;
  summary: string | null;
  status: string | null;
  plot_outline: PlotOutline | null;
  plot_version: number | null;
  plot_updated_at: string | null;
  plot_change_summary: string | null;
  shot_outline: ShotOutline | null;
  outline_version: number | null;
  outline_updated_at: string | null;
  outline_change_summary: string | null;
  storyboard_version: number | null;
  storyboard_updated_at: string | null;
  outline_based_on_plot_version: number | null;
  storyboard_based_on_outline_version: number | null;
  scenes?: { id: string }[] | null;
}

interface TaskRow {
  id: string;
  status: string;
  task_type: string;
  payload?: { episodeNumber?: number } | null;
}

// ============================================
// 组件
// ============================================

export function ScriptView({
  projectId,
  initial,
  story,
  episodes,
  activeTasks = [],
}: {
  projectId: string;
  initial: ScriptData | null;
  story?: StoryIdea | null;
  episodes: EpisodeRow[] | null;
  activeTasks?: TaskRow[];
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [optPanel, setOptPanel] = useState<string | null>(null);
  const [optPrompt, setOptPrompt] = useState("");

  // 手动编辑模式状态
  const [editMode, setEditMode] = useState<{ type: "plot" | "outline"; episodeId: string } | null>(null);
  const [editPlot, setEditPlot] = useState<PlotOutline>({});
  const [editOutlineScenes, setEditOutlineScenes] = useState<ShotOutlineScene[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const epList = episodes || [];
  const generatedCount = epList.filter((e) => !!e.plot_outline).length;

  // 有集级任务进行中时自动轮询刷新（任务完成/失败后 UI 自动更新，activeTasks 清空即自动停止）
  const hasActiveTask = activeTasks.length > 0;
  useEffect(() => {
    if (!hasActiveTask) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [hasActiveTask, router]);

  /** 该集是否有进行中的任务 */
  const isEpisodeBusy = (episodeNumber: number, taskType?: string) =>
    activeTasks.some(
      (t) =>
        t.payload?.episodeNumber === episodeNumber &&
        (!taskType || t.task_type === taskType)
    );

  /** 创建任务 */
  const runTask = async (
    taskType: string,
    episodeNumber: number,
    key: string,
    tip: string
  ) => {
    setBusyKey(key);
    toast.info(tip);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // payload 必须包住 episodeNumber：API / handler / 集级唯一索引都从 payload 内读取
        body: JSON.stringify({ taskType, payload: { episodeNumber } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建任务失败");
      toast.success("已提交生成任务，完成后自动刷新");
      setOptPanel(null);
      setOptPrompt("");
      setTimeout(() => router.refresh(), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    } finally {
      setBusyKey(null);
    }
  };

  /** 追加新集 */
  const handleAppendEpisode = async () => {
    setBusyKey("append");
    try {
      const res = await fetch(`/api/projects/${projectId}/episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "追加新集失败");
      toast.success(`已追加第 ${data.data.episode_number} 集`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "追加新集失败");
    } finally {
      setBusyKey(null);
    }
  };

  /** 进入剧情大纲编辑模式 */
  const startEditPlot = (ep: EpisodeRow) => {
    setEditMode({ type: "plot", episodeId: ep.id });
    setEditPlot(ep.plot_outline ? { ...ep.plot_outline } : {});
    setEditTitle(ep.title || "");
  };

  /** 进入分镜大纲编辑模式 */
  const startEditOutline = (ep: EpisodeRow) => {
    setEditMode({ type: "outline", episodeId: ep.id });
    setEditOutlineScenes(
      ep.shot_outline?.scenes
        ? ep.shot_outline.scenes.map((s) => ({ ...s, key_shots: s.key_shots ? [...s.key_shots] : undefined }))
        : []
    );
  };

  /** 保存剧情大纲编辑 */
  const saveEditPlot = async (episodeId: string) => {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/episodes/${episodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plot_outline: editPlot, title: editTitle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      toast.success("剧情大纲已保存（版本号 +1，下游需重新生成）");
      setEditMode(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingEdit(false);
    }
  };

  /** 保存分镜大纲编辑 */
  const saveEditOutline = async (episodeId: string) => {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/episodes/${episodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shot_outline: { scenes: editOutlineScenes } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      toast.success("分镜大纲已保存（版本号 +1，下游需重新生成）");
      setEditMode(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingEdit(false);
    }
  };

  /** 取消编辑 */
  const cancelEdit = () => {
    setEditMode(null);
    setEditPlot({});
    setEditOutlineScenes([]);
    setEditTitle("");
  };

  // ============================================
  // 渲染：Episode 骨架由项目初始化创建，直接渲染列表
  // （不再以 scripts 表为门槛 —— 剧情大纲可基于 stories 故事创意自主规划）
  // ============================================
  return (
    <div className="max-w-6xl">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold mb-1">Episode 列表</h2>
          <p className="text-xs text-muted-foreground">
            共 {epList.length} 集骨架 · 已生成剧情{" "}
            <span className="text-green-400">{generatedCount}</span> 集 ·
            剧情大纲与分镜大纲同卡展示，逐集独立生成
          </p>
        </div>
        <button
          onClick={handleAppendEpisode}
          disabled={busyKey === "append"}
          className="px-3.5 py-2 rounded-lg bg-surface2 border border-border text-muted-foreground text-xs hover:border-primary/50 hover:text-primary transition disabled:opacity-40"
        >
          {busyKey === "append" ? "追加中..." : "+ 追加新集"}
        </button>
      </div>

      {/* 项目设定（折叠）—— 旧链路 scripts 剧本骨架优先；新架构展示 stories 故事创意 */}
      <div className="mb-4 bg-card border border-border rounded-xl overflow-hidden">
        <Collapse defaultOpen={false}>
          <CollapseTrigger className="px-5 py-3.5 hover:bg-surface2/50 gap-2">
            <span className="w-1 h-4 bg-primary rounded" />
            <span className="text-sm font-medium text-foreground">项目设定</span>
            <span className="text-[10px] text-muted-foreground">
              {initial
                ? "故事梗概 · 世界观 · 角色关系（全局，非单集）"
                : "故事创意 · 题材 · 核心冲突（来自项目初始化）"}
            </span>
            {(initial?.genre || story?.genre) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border ml-auto mr-1">
                {initial?.genre || story?.genre}
              </span>
            )}
          </CollapseTrigger>
          <CollapseContent className="border-t border-border px-5 py-4 space-y-3">
            {initial?.synopsis ? (
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">故事梗概</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {initial.synopsis}
                </p>
              </div>
            ) : story?.raw_input ? (
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">原始创意</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {story.raw_input}
                </p>
              </div>
            ) : null}
            {initial?.worldview && (
              <div className="pt-3 border-t border-border">
                <div className="text-[10px] text-muted-foreground mb-1">世界观</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {initial.worldview}
                </p>
              </div>
            )}
            {!initial?.worldview &&
              (story?.theme || story?.core_conflict || story?.target_emotion) && (
                <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {story?.theme && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">题材</div>
                      <p className="text-[11px] text-muted-foreground">{story.theme}</p>
                    </div>
                  )}
                  {story?.core_conflict && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">核心冲突</div>
                      <p className="text-[11px] text-muted-foreground">{story.core_conflict}</p>
                    </div>
                  )}
                  {story?.target_emotion && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1">目标情绪</div>
                      <p className="text-[11px] text-muted-foreground">{story.target_emotion}</p>
                    </div>
                  )}
                </div>
              )}
            {initial?.relationships && (
              <div className="pt-3 border-t border-border">
                <div className="text-[10px] text-muted-foreground mb-1">角色关系</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {initial.relationships}
                </p>
              </div>
            )}
            {initial?.characters && initial.characters.length > 0 && (
              <div className="pt-3 border-t border-border">
                <div className="text-[10px] text-muted-foreground mb-1.5">
                  角色（{initial.characters.length}）
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {initial.characters.map((c, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border"
                      title={c.description}
                    >
                      {c.name}
                      {c.role && <span className="text-primary ml-1">{c.role}</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CollapseContent>
        </Collapse>
      </div>

      {/* Episode 列表 */}
      {epList.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl py-12 flex flex-col items-center gap-3">
          <span className="text-2xl opacity-25">📖</span>
          <p className="text-xs text-muted-foreground">
            还没有 Episode 骨架 —— 项目初始化时会按集数范围自动创建
          </p>
        </div>
      ) : (
        epList.map((ep, epIdx) => {
          const hasPlot = !!ep.plot_outline;
          const hasOutline = !!ep.shot_outline;
          const hasStoryboard = (ep.scenes || []).length > 0;
          const plotVer = ep.plot_version ?? 1;
          const outlineVer = ep.outline_version ?? 1;

          // 上游脏：分镜大纲依据的 plot_version 落后
          const outlineDirty =
            hasOutline &&
            ep.outline_based_on_plot_version != null &&
            ep.outline_based_on_plot_version < plotVer;
          // 分镜内容依据的 outline_version 落后
          const storyboardDirty =
            hasStoryboard &&
            ep.storyboard_based_on_outline_version != null &&
            ep.storyboard_based_on_outline_version < outlineVer;

          const plotBusy =
            busyKey === `plot-${ep.episode_number}` ||
            isEpisodeBusy(ep.episode_number, "generate_episode_plot");
          const outlineBusy =
            busyKey === `outline-${ep.episode_number}` ||
            isEpisodeBusy(ep.episode_number, "generate_episode_outline");

          const epDirty = outlineDirty || storyboardDirty;

          return (
            <div
              key={ep.id}
              className={`mb-3 bg-card rounded-xl overflow-hidden border ${
                epDirty ? "border-stale/40" : "border-border"
              }`}
            >
              <Collapse defaultOpen={epIdx === 0 || epDirty}>
                <CollapseTrigger
                  className={`px-5 py-4 gap-3 hover:bg-surface2/50 ${
                    epDirty ? "bg-stale/5" : ""
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                      plotBusy
                        ? "bg-primary/15 text-primary"
                        : hasPlot
                        ? "bg-green-500/15 text-green-400"
                        : "bg-surface2 border border-border text-muted-foreground/70"
                    }`}
                  >
                    {plotBusy ? (
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    ) : (
                      String(ep.episode_number).padStart(2, "0")
                    )}
                  </span>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-medium text-foreground text-sm">
                        {ep.title || `第 ${ep.episode_number} 集`}
                      </span>
                      {hasPlot && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border font-mono">
                          剧情 v{plotVer}
                        </span>
                      )}
                      {hasOutline ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border font-mono">
                          分镜大纲 v{outlineVer}
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground/70 border border-border">
                          分镜大纲未生成
                        </span>
                      )}
                      {epDirty && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-stale/20 text-stale border border-stale/40">
                          ⚠ 上游已变更
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {plotBusy
                        ? "正在生成剧情大纲…"
                        : hasPlot
                        ? ep.plot_outline?.core_conflict ||
                          ep.plot_outline?.summary ||
                          ep.summary ||
                          "已生成剧情大纲"
                        : "尚未生成剧情大纲"}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-1 rounded-full shrink-0 ${
                      plotBusy
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : hasPlot && hasOutline
                        ? "bg-green-500/15 text-green-400 border border-green-500/30"
                        : hasPlot
                        ? "bg-surface2 text-muted-foreground border border-border"
                        : "bg-surface2 text-muted-foreground/70 border border-border"
                    }`}
                  >
                    {plotBusy
                      ? "生成中"
                      : hasPlot && hasOutline
                      ? "已就绪"
                      : hasPlot
                      ? "待补分镜大纲"
                      : "未生成"}
                  </span>
                </CollapseTrigger>

                <CollapseContent className="border-t border-border">
                  {/* 上游变更提示条 */}
                  {epDirty && (
                    <div className="bg-stale/10 border-b border-stale/30 px-5 py-3">
                      <div className="text-[11px] text-stale font-semibold mb-0.5">
                        {outlineDirty
                          ? `本集剧情大纲已更新至 v${plotVer}，分镜大纲仍基于 v${ep.outline_based_on_plot_version}`
                          : `本集分镜大纲已更新至 v${outlineVer}，分镜内容仍基于 v${ep.storyboard_based_on_outline_version}`}
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-relaxed">
                        修复顺序必须从最上游开始：剧情大纲 → 分镜大纲 → 分镜内容 → 画面指令，
                        跳级修复会让 AI 基于旧规划工作
                      </div>
                    </div>
                  )}

                  <div className="p-5 space-y-6">
                    {/* ===== 剧情大纲 ===== */}
                    <div>
                      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="w-1 h-4 bg-primary rounded" />
                          <h4 className="text-sm font-medium text-foreground">剧情大纲</h4>
                          {hasPlot && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border font-mono">
                              v{plotVer}
                            </span>
                          )}
                          {ep.plot_updated_at && (
                            <span className="text-[10px] text-muted-foreground/70">
                              · 生成于{" "}
                              {new Date(ep.plot_updated_at).toLocaleString("zh-CN")}
                            </span>
                          )}
                        </div>
                        {hasPlot && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEditPlot(ep)}
                              disabled={editMode?.type === "plot" && editMode.episodeId === ep.id || savingEdit}
                              className="px-2.5 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition disabled:opacity-40"
                            >
                              ✏ 编辑
                            </button>
                            <button
                              onClick={() =>
                                setOptPanel(
                                  optPanel === `plot-${ep.id}` ? null : `plot-${ep.id}`
                                )
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition"
                            >
                              ✨ AI 优化
                            </button>
                            <button
                              onClick={() =>
                                runTask(
                                  "generate_episode_plot",
                                  ep.episode_number,
                                  `plot-${ep.episode_number}`,
                                  `重新生成第 ${ep.episode_number} 集剧情大纲...`
                                )
                              }
                              disabled={plotBusy}
                              className="px-2.5 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition disabled:opacity-40"
                            >
                              {plotBusy ? "生成中..." : "⟳ 重新生成"}
                            </button>
                          </div>
                        )}
                      </div>

                      {editMode?.type === "plot" && editMode.episodeId === ep.id ? (
                        <div className="bg-primary/5 border border-primary/30 rounded-lg p-4 space-y-3">
                          <div className="text-[11px] text-primary font-medium mb-1">手动编辑剧情大纲（保存后版本号 +1）</div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] text-muted-foreground">集标题</label>
                            <Input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              placeholder={`第 ${ep.episode_number} 集`}
                              className="text-xs h-8"
                            />
                          </div>
                          <div className="grid gap-2">
                            <div>
                              <label className="text-[10px] text-muted-foreground">开场</label>
                              <Textarea
                                rows={2}
                                value={editPlot.opening || ""}
                                onChange={(e) => setEditPlot({ ...editPlot, opening: e.target.value })}
                                className="text-xs mt-1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground">转折</label>
                              <Textarea
                                rows={2}
                                value={editPlot.turning_point || ""}
                                onChange={(e) => setEditPlot({ ...editPlot, turning_point: e.target.value })}
                                className="text-xs mt-1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground">冲突</label>
                              <Textarea
                                rows={2}
                                value={editPlot.conflict || ""}
                                onChange={(e) => setEditPlot({ ...editPlot, conflict: e.target.value })}
                                className="text-xs mt-1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground">结尾</label>
                              <Textarea
                                rows={2}
                                value={editPlot.ending || ""}
                                onChange={(e) => setEditPlot({ ...editPlot, ending: e.target.value })}
                                className="text-xs mt-1"
                              />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <label className="text-[10px] text-muted-foreground">核心冲突</label>
                                <Input
                                  value={editPlot.core_conflict || ""}
                                  onChange={(e) => setEditPlot({ ...editPlot, core_conflict: e.target.value })}
                                  className="text-xs h-8 mt-1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground">情绪基调</label>
                                <Input
                                  value={editPlot.emotional_tone || ""}
                                  onChange={(e) => setEditPlot({ ...editPlot, emotional_tone: e.target.value })}
                                  className="text-xs h-8 mt-1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground">出场角色（逗号分隔）</label>
                                <Input
                                  value={editPlot.characters?.join("、") || ""}
                                  onChange={(e) =>
                                    setEditPlot({
                                      ...editPlot,
                                      characters: e.target.value
                                        ? e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
                                        : undefined,
                                    })
                                  }
                                  className="text-xs h-8 mt-1"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => saveEditPlot(ep.id)}
                              disabled={savingEdit}
                              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition disabled:opacity-40"
                            >
                              {savingEdit ? "保存中..." : `保存（v${plotVer + 1}）`}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={savingEdit}
                              className="px-3 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition disabled:opacity-40"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : hasPlot ? (
                        <div className="bg-surface2 border border-border rounded-lg p-4 text-[11px] text-muted-foreground leading-relaxed space-y-2">
                          {ep.plot_outline?.opening && (
                            <p>
                              <span className="text-foreground font-medium">开场：</span>
                              {ep.plot_outline.opening}
                            </p>
                          )}
                          {ep.plot_outline?.turning_point && (
                            <p>
                              <span className="text-foreground font-medium">转折：</span>
                              {ep.plot_outline.turning_point}
                            </p>
                          )}
                          {ep.plot_outline?.conflict && (
                            <p>
                              <span className="text-foreground font-medium">冲突：</span>
                              {ep.plot_outline.conflict}
                            </p>
                          )}
                          {ep.plot_outline?.ending && (
                            <p>
                              <span className="text-foreground font-medium">结尾：</span>
                              {ep.plot_outline.ending}
                            </p>
                          )}
                          {/* 迁移过渡数据：只有 summary */}
                          {!ep.plot_outline?.opening && ep.plot_outline?.summary && (
                            <p>{ep.plot_outline.summary}</p>
                          )}
                          {(ep.plot_outline?.core_conflict ||
                            ep.plot_outline?.emotional_tone ||
                            ep.plot_outline?.characters?.length) && (
                            <div className="pt-2.5 mt-1 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-3 text-[10px]">
                              {ep.plot_outline?.core_conflict && (
                                <div>
                                  <span className="text-muted-foreground/70">核心冲突：</span>
                                  <span className="text-muted-foreground">
                                    {ep.plot_outline.core_conflict}
                                  </span>
                                </div>
                              )}
                              {ep.plot_outline?.emotional_tone && (
                                <div>
                                  <span className="text-muted-foreground/70">情绪基调：</span>
                                  <span className="text-muted-foreground">
                                    {ep.plot_outline.emotional_tone}
                                  </span>
                                </div>
                              )}
                              {ep.plot_outline?.characters?.length ? (
                                <div>
                                  <span className="text-muted-foreground/70">出场角色：</span>
                                  <span className="text-muted-foreground">
                                    {ep.plot_outline.characters.join("、")}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-surface2/50 border border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3">
                          <span className="text-2xl opacity-25">📖</span>
                          <p className="text-[11px] text-muted-foreground text-center max-w-sm leading-relaxed">
                            剧情大纲将本集扩写为结构化情节（开场 / 转折 / 冲突 / 结尾），
                            是分镜大纲与后续全部产物的源头。
                          </p>
                          <button
                            onClick={() =>
                              runTask(
                                "generate_episode_plot",
                                ep.episode_number,
                                `plot-${ep.episode_number}`,
                                `生成第 ${ep.episode_number} 集剧情大纲...`
                              )
                            }
                            disabled={plotBusy}
                            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition disabled:opacity-40"
                          >
                            {plotBusy ? "生成中..." : "生成剧情大纲"}
                          </button>
                          <button
                            onClick={() => startEditPlot(ep)}
                            className="px-3 py-2 rounded-lg bg-surface2 border border-border text-muted-foreground text-xs hover:border-primary/50 hover:text-primary transition"
                          >
                            ✏ 手动编辑
                          </button>
                        </div>
                      )}

                      {/* AI 优化面板 */}
                      {optPanel === `plot-${ep.id}` && (
                        <div className="mt-3 bg-primary/5 border border-primary/30 rounded-lg p-4">
                          <label className="block text-[11px] text-primary mb-2">
                            ✨ 输入优化提示词
                          </label>
                          <Textarea
                            rows={2}
                            value={optPrompt}
                            onChange={(e) => setOptPrompt(e.target.value)}
                            placeholder="如：强化结尾的悬念钩子，让冲突更早爆发"
                            className="text-xs"
                          />
                          <div className="flex items-center gap-2 mt-3">
                            <button
                              onClick={() =>
                                runTask(
                                  "generate_episode_plot",
                                  ep.episode_number,
                                  `plot-${ep.episode_number}`,
                                  `按优化提示重新生成第 ${ep.episode_number} 集剧情...`
                                )
                              }
                              disabled={plotBusy}
                              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-40"
                            >
                              生成优化版本（v{plotVer + 1}）
                            </button>
                            <button
                              onClick={() => {
                                setOptPanel(null);
                                setOptPrompt("");
                              }}
                              className="px-4 py-2 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px]"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ===== 分镜大纲 ===== */}
                    <div>
                      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-1 h-4 rounded ${
                              hasOutline ? "bg-primary" : "bg-border"
                            }`}
                          />
                          <h4
                            className={`text-sm font-medium ${
                              hasOutline ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            分镜大纲
                          </h4>
                          {hasOutline ? (
                            <>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border font-mono">
                                v{outlineVer}
                              </span>
                              <span className="text-[10px] text-muted-foreground/70">
                                · {ep.shot_outline?.scenes?.length || 0} 个场景规划
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground/70 border border-border">
                              未生成
                            </span>
                          )}
                          {outlineDirty && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stale/20 text-stale border border-stale/40">
                              上游脏
                            </span>
                          )}
                        </div>
                        {hasOutline && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEditOutline(ep)}
                              disabled={editMode?.type === "outline" && editMode.episodeId === ep.id || savingEdit}
                              className="px-2.5 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition disabled:opacity-40"
                            >
                              ✏ 编辑
                            </button>
                            <button
                              onClick={() =>
                                runTask(
                                  "generate_episode_outline",
                                  ep.episode_number,
                                  `outline-${ep.episode_number}`,
                                  `重新生成第 ${ep.episode_number} 集分镜大纲...`
                                )
                              }
                              disabled={outlineBusy}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] transition disabled:opacity-40 ${
                                outlineDirty
                                  ? "bg-stale text-stale-foreground font-semibold hover:bg-stale/90"
                                  : "bg-surface2 border border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
                              }`}
                            >
                              {outlineBusy ? "生成中..." : "⟳ 重新生成"}
                            </button>
                          </div>
                        )}
                      </div>

                      {editMode?.type === "outline" && editMode.episodeId === ep.id ? (
                        <div className="bg-primary/5 border border-primary/30 rounded-lg p-4 space-y-3">
                          <div className="text-[11px] text-primary font-medium">手动编辑分镜大纲（保存后版本号 +1）</div>
                          {editOutlineScenes.map((sc, si) => (
                            <div key={si} className="bg-background border border-border rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono">
                                  S{sc.scene_number}
                                </span>
                                <button
                                  onClick={() => setEditOutlineScenes(editOutlineScenes.filter((_, i) => i !== si))}
                                  className="text-[10px] text-destructive hover:underline"
                                >
                                  删除场景
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-muted-foreground">场景标题</label>
                                  <Input
                                    value={sc.title || ""}
                                    onChange={(e) => setEditOutlineScenes(editOutlineScenes.map((s, i) => i === si ? { ...s, title: e.target.value } : s))}
                                    className="text-xs h-8 mt-1"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground">场景地点</label>
                                  <Input
                                    value={sc.location || ""}
                                    onChange={(e) => setEditOutlineScenes(editOutlineScenes.map((s, i) => i === si ? { ...s, location: e.target.value } : s))}
                                    className="text-xs h-8 mt-1"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground">预估镜头数</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={sc.shot_count_estimate ?? ""}
                                    onChange={(e) => setEditOutlineScenes(editOutlineScenes.map((s, i) => i === si ? { ...s, shot_count_estimate: e.target.value ? Number(e.target.value) : undefined } : s))}
                                    className="text-xs h-8 mt-1"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground">情绪走向</label>
                                  <Input
                                    value={sc.emotion || ""}
                                    onChange={(e) => setEditOutlineScenes(editOutlineScenes.map((s, i) => i === si ? { ...s, emotion: e.target.value } : s))}
                                    className="text-xs h-8 mt-1"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground">重点镜头（逗号分隔）</label>
                                <Input
                                  value={sc.key_shots?.join("、") || ""}
                                  onChange={(e) =>
                                    setEditOutlineScenes(
                                      editOutlineScenes.map((s, i) =>
                                        i === si
                                          ? {
                                              ...s,
                                              key_shots: e.target.value
                                                ? e.target.value.split(/[、,，]/).map((k) => k.trim()).filter(Boolean)
                                                : undefined,
                                            }
                                          : s
                                      )
                                    )
                                  }
                                  className="text-xs h-8 mt-1"
                                />
                              </div>
                            </div>
                          ))}
                          <button
                            onClick={() =>
                              setEditOutlineScenes([
                                ...editOutlineScenes,
                                {
                                  scene_number: (editOutlineScenes[editOutlineScenes.length - 1]?.scene_number ?? 0) + 1,
                                },
                              ])
                            }
                            className="w-full py-2 rounded-lg border border-dashed border-border text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary transition"
                          >
                            + 添加场景
                          </button>
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => saveEditOutline(ep.id)}
                              disabled={savingEdit}
                              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition disabled:opacity-40"
                            >
                              {savingEdit ? "保存中..." : "保存"}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={savingEdit}
                              className="px-3 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition disabled:opacity-40"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : hasOutline ? (
                        <div className="space-y-2">
                          {(ep.shot_outline?.scenes || []).map((sc) => (
                            <div
                              key={sc.scene_number}
                              className="bg-surface2 border border-border rounded-lg p-3.5 flex gap-3"
                            >
                              <span className="w-6 h-6 rounded bg-primary/15 text-primary text-[11px] font-medium flex items-center justify-center shrink-0">
                                S{sc.scene_number}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  {sc.title && (
                                    <span className="text-xs text-foreground">{sc.title}</span>
                                  )}
                                  {sc.location && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-muted-foreground">
                                      {sc.location}
                                    </span>
                                  )}
                                  {sc.shot_count_estimate ? (
                                    <span className="text-[10px] text-muted-foreground">
                                      约 {sc.shot_count_estimate} 镜
                                    </span>
                                  ) : null}
                                  {sc.emotion && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                      {sc.emotion}
                                    </span>
                                  )}
                                </div>
                                {sc.key_shots?.length ? (
                                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                                    重点镜头：{sc.key_shots.join(" · ")}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bg-surface2/50 border border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3">
                          <span className="text-2xl opacity-25">📋</span>
                          <p className="text-[11px] text-muted-foreground text-center max-w-sm leading-relaxed">
                            分镜大纲将剧情拆分为可拍摄的场景规划，包含场景数、每场景镜头数估算、情绪走向和重点镜头建议。
                          </p>
                          <button
                            onClick={() =>
                              runTask(
                                "generate_episode_outline",
                                ep.episode_number,
                                `outline-${ep.episode_number}`,
                                `生成第 ${ep.episode_number} 集分镜大纲...`
                              )
                            }
                            disabled={outlineBusy || !hasPlot}
                            title={!hasPlot ? "请先生成本集剧情大纲" : undefined}
                            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {outlineBusy
                              ? "生成中..."
                              : !hasPlot
                              ? "需先生成剧情大纲"
                              : "生成分镜大纲"}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ===== 下游状态 ===== */}
                    <div className="pt-4 border-t border-border flex items-center gap-4 text-[11px] flex-wrap">
                      <span className="text-muted-foreground/70">下游状态：</span>
                      {hasStoryboard ? (
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              storyboardDirty ? "bg-stale" : "bg-green-500"
                            }`}
                          />
                          <span className="text-muted-foreground">
                            分镜内容已生成（{(ep.scenes || []).length} 场景
                            {ep.storyboard_version ? ` · v${ep.storyboard_version}` : ""}）
                          </span>
                          {storyboardDirty && (
                            <span className="text-stale">— 需重新生成</span>
                          )}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-muted-foreground/70">
                          <span className="w-1.5 h-1.5 rounded-full bg-border" />
                          分镜未生成{!hasOutline && "（需先有分镜大纲）"}
                        </span>
                      )}
                      <Link
                        href={`/projects/${projectId}/storyboard`}
                        className="text-primary hover:underline ml-auto"
                      >
                        前往分镜 Tab →
                      </Link>
                    </div>
                  </div>
                </CollapseContent>
              </Collapse>
            </div>
          );
        })
      )}

      {/* 追加新集 */}
      {initial && (
        <button
          onClick={handleAppendEpisode}
          disabled={busyKey === "append"}
          className="mt-3 w-full py-3 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition disabled:opacity-40"
        >
          {busyKey === "append" ? "追加中..." : "+ 追加新集"}
        </button>
      )}
    </div>
  );
}
