"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTaskPolling, type ActiveTask } from "@/hooks/use-task-polling";
import { PreviewableImage } from "@/components/ui/previewable-image";

// ============================================
// 角色库（对照原型 prototype-v2/03-assets.html 角色部分）
//   锁定状态横幅 / 卡片网格（头图 + stable_key）/
//   AI 优化展开态（生成优化版本）/ 锁定态 lockable 禁用 + 上传 always-on
// ============================================

interface Character {
  id: string;
  name: string;
  role: string | null;
  age: number | null;
  gender: string | null;
  appearance: string | null;
  personality: string | null;
  background: string | null;
  clothing: string | null;
  fixed_prompt: string;
  portrait_asset_id: string | null;
  stable_key: string;
  is_locked: boolean;
}

const emptyChar: Record<string, string> = {
  name: "", role: "", age: "", gender: "", appearance: "", personality: "", background: "", clothing: "", fixed_prompt: ""
};

/** 角色 chip 配色（对照原型：主角 primary / 女主 blue / 反派 red / 神秘 orange / 其它灰） */
function roleChipClass(role: string | null): string {
  const r = role || "";
  if (r.includes("男主") || r === "主角") return "bg-primary/20 text-primary";
  if (r.includes("女主")) return "bg-blue-500/20 text-blue-400";
  if (r.includes("反派")) return "bg-red-500/20 text-red-400";
  if (r.includes("神秘")) return "bg-orange-500/20 text-orange-400";
  return "bg-surface2 text-muted-foreground border border-border";
}

export function CharacterList({
  projectId,
  initial,
  activeTask,
  assetUrls = {},
  versionMap = {},
  assetLocked = false,
  plotCount = 0,
}: {
  projectId: string;
  initial: Character[];
  activeTask?: ActiveTask | null;
  assetUrls?: Record<string, string>;
  versionMap?: Record<string, number>;
  /** 项目级锁定：已生成任何一集剧情后角色/场景/风格文字配置锁定 */
  assetLocked?: boolean;
  /** 已生成剧情的集数（锁定横幅展示用） */
  plotCount?: number;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Character | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyChar);
  const [loading, setLoading] = useState(false);
  const [specsOpen, setSpecsOpen] = useState<string | null>(null);
  const [specsMap, setSpecsMap] = useState<Map<string, Array<{ spec_type: string; spec_name: string; spec_prompt: string }>>>(new Map());
  const [genSpecsLoading, setGenSpecsLoading] = useState(false);

  // AI 优化展开态（对照原型：optimizingId 对应的卡片切换为优化版式）
  const [optimizingId, setOptimizingId] = useState<string | null>(null);
  const [optimizePrompt, setOptimizePrompt] = useState("");
  const [optimizing, setOptimizing] = useState(false);

  // 上传状态（上传按钮 always-on，锁定态下仍可上传）
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<string | null>(null);

  const { isGenerating, createTask } = useTaskPolling({
    projectId,
    initialTask: activeTask,
    onDone: (status) => {
      if (status === "success") toast.success("角色生成完成");
      else toast.error("角色生成失败");
      router.refresh();
    },
  });

  // Sync when initial changes (after router.refresh() or AI generation)
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setList(initial);
  }

  // 本地 URL 映射：上传成功即写入（assetUrls prop 来自服务端，不含刚上传的 asset，
  // 若直接用会导致图片区不更新——上传 API 返回的 url 立即可用）
  const [localAssetUrls, setLocalAssetUrls] = useState(assetUrls);
  const [prevUrls, setPrevUrls] = useState(assetUrls);
  if (prevUrls !== assetUrls) {
    setPrevUrls(assetUrls);
    setLocalAssetUrls(assetUrls);
  }

  // ---------- 上传参考图（always-on：锁定态仍可上传，已上传可替换） ----------
  // 替换参考图的二次确认目标（null = Dialog 关闭）
  const [replaceTarget, setReplaceTarget] = useState<Character | null>(null);

  // 复制出图提示词（fixed_prompt）：去外部平台（即梦/Midjourney 等）生成角色定妆照后上传回来
  const handleCopyPrompt = useCallback(async (c: Character) => {
    try {
      await navigator.clipboard.writeText(c.fixed_prompt);
      toast.success(`已复制 ${c.name} 的出图提示词`);
    } catch {
      toast.error("复制失败，请在编辑弹窗中手动复制");
    }
  }, []);

  const handleUploadClick = useCallback((charId: string) => {
    uploadTargetRef.current = charId;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const charId = uploadTargetRef.current;
      e.target.value = "";
      if (!file || !charId) return;

      setUploadingId(charId);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("projectId", projectId);
        formData.append("entityType", "character");
        formData.append("entityId", charId);
        formData.append("assetType", "character_portrait");

        const res = await fetch("/api/assets/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "上传失败");

        // 函数式更新：快速连续上传时避免陈旧闭包把前一笔指针更新覆盖丢失
        setList(prev => prev.map(item => item.id === charId ? { ...item, portrait_asset_id: data.assetId } : item));
        // 立即写入 URL 映射，图片区无需刷新即时显示
        setLocalAssetUrls(prev => ({ ...prev, [data.assetId]: data.url }));
        toast.success("参考图上传成功");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploadingId(null);
        uploadTargetRef.current = null;
      }
    },
    [projectId]
  );

  // ---------- AI 优化（生成优化版本，对照原型卡片展开态） ----------
  const handleOptimize = async (charId: string) => {
    if (!optimizePrompt.trim()) {
      toast.error("请输入优化提示词");
      return;
    }
    setOptimizing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/assets/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "character", entity_id: charId, prompt: optimizePrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "优化失败");

      setList(list.map(c => (c.id === charId ? { ...c, ...data.data } : c)));
      toast.success(`已生成优化版本 v${data.version}`);
      setOptimizingId(null);
      setOptimizePrompt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "优化失败");
    } finally {
      setOptimizing(false);
    }
  };

  // ---------- 全部重新生成（⟳，lockable） ----------
  const handleRegenerate = async () => {
    const confirmed = window.confirm(
      "AI 将重新生成角色，已有角色会被更新或新增，AI 不会删除你的角色，是否继续？"
    );
    if (!confirmed) return;
    try {
      await createTask("regenerate_characters", {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // ---------- 编辑 Dialog（含视觉规范 / 删除 / 单资产锁定） ----------
  const openCreate = () => {
    setEditing(null);
    setForm(emptyChar);
    setOpen(true);
  };

  const openEdit = (c: Character) => {
    setEditing(c);
    setForm({
      name: c.name, role: c.role || "", age: c.age?.toString() || "", gender: c.gender || "",
      appearance: c.appearance || "", personality: c.personality || "", background: c.background || "",
      clothing: c.clothing || "", fixed_prompt: c.fixed_prompt
    });
    setOpen(true);
  };

  const handleShowSpecs = async (charId: string) => {
    if (specsOpen === charId) {
      setSpecsOpen(null);
      return;
    }
    setSpecsOpen(charId);
    if (!specsMap.has(charId)) {
      try {
        const res = await fetch(`/api/projects/${projectId}/characters/${charId}/visual-specs`);
        if (res.ok) {
          const data = await res.json();
          const newMap = new Map(specsMap);
          newMap.set(charId, data.specs || []);
          setSpecsMap(newMap);
        }
      } catch {
        // ignore
      }
    }
  };

  const handleGenSpecs = async (charId: string) => {
    setGenSpecsLoading(true);
    toast.info("正在生成视觉规范...");
    try {
      const res = await fetch(`/api/projects/${projectId}/characters/${charId}/visual-specs`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      const newMap = new Map(specsMap);
      newMap.set(charId, data.specs || []);
      setSpecsMap(newMap);
      toast.success("视觉规范生成完成");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenSpecsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.fixed_prompt.trim()) {
      toast.error("名称和固定 Prompt 不能为空");
      return;
    }
    setLoading(true);

    const url = editing
      ? `/api/projects/${projectId}/characters/${editing.id}`
      : `/api/projects/${projectId}/characters`;
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, age: form.age ? parseInt(form.age) : null }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) { toast.error(data.error || "操作失败"); return; }

    if (editing) {
      setList(list.map(c => c.id === editing.id ? data.data : c));
      toast.success("已更新");
    } else {
      setList([...list, data.data]);
      toast.success("已创建");
    }
    setOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此角色？")) return;
    const res = await fetch(`/api/projects/${projectId}/characters/${id}`, { method: "DELETE" });
    if (res.ok) {
      setList(list.filter(c => c.id !== id));
      setOpen(false);
      toast.success("已删除");
    } else {
      toast.error("删除失败");
    }
  };

  const isLockedEditing = !!editing?.is_locked;

  const field = (key: string, label: string, multiline = false) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={key}>{label}</Label>
      {multiline ? (
        <Textarea id={key} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} rows={3} disabled={isLockedEditing} />
      ) : (
        <Input id={key} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} disabled={isLockedEditing} />
      )}
    </div>
  );

  // lockable 禁用工具类（对照原型 .lockable + setLock）
  const lockable = assetLocked ? "opacity-40 pointer-events-none cursor-not-allowed" : "";

  return (
    <div className="flex flex-col gap-0">
      {/* 隐藏 file input：上传参考图（always-on） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 锁定状态横幅（对照原型双态横幅） */}
      {assetLocked ? (
        <div className="mb-6 bg-locked/15 border border-locked/50 rounded-xl p-4 flex gap-3">
          <span className="text-muted-foreground text-lg leading-none mt-0.5">🔒</span>
          <div className="flex-1">
            <div className="text-sm text-foreground/80 font-medium mb-1.5">资产已锁定（已生成 {plotCount} 集剧情）</div>
            <div className="text-xs text-muted-foreground leading-relaxed mb-2.5">
              剧情大纲中已写入角色名与场景名，风格已注入全部 Prompt。为保证视觉一致性，
              <span className="text-foreground/70">角色 / 场景 / 风格的文字配置全部禁用</span>。
              <br />
              <span className="text-muted-foreground/70">如需修改：设置页 → 危险操作 → 清空全部剧情（会连带删除分镜与 Prompt）。</span>
            </div>
            <div className="bg-green-500/8 border border-green-500/25 rounded-lg px-3.5 py-2.5 flex gap-2.5">
              <span className="text-green-400 text-sm leading-none mt-0.5">✓</span>
              <div className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-green-400 font-medium">锁定后仍可上传参考图</span> —
                尚未上传图片的角色<span className="text-foreground/70">随时可以补充上传</span>（图片只是补充视觉信息，不改变文字语义，不会让任何内容过期）。
                <br />
                <span className="text-green-400 font-medium">已上传的参考图可随时替换</span>（替换仅更新图片本身，已生成的提示词内容不受影响，引用自动指向新图）。
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-6 bg-green-500/8 border border-green-500/25 rounded-xl p-4 flex gap-3">
          <span className="text-green-400 text-lg leading-none mt-0.5">🔓</span>
          <div className="flex-1">
            <div className="text-sm text-green-400 font-medium mb-1">资产可自由编辑</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              当前尚未生成任何 Episode 剧情，角色 / 场景 / 风格均可通过
              <span className="text-foreground/80"> AI 提示词优化</span> 或
              <span className="text-foreground/80"> 手动编辑</span> 修改，也可整体重新生成。
              <span className="text-stale">一旦生成第一集剧情，本页全部配置将锁定。</span>
            </div>
          </div>
        </div>
      )}

      {/* 标题行（对照原型：角色库 N 个 + 操作按钮） */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            角色库 <span className="text-sm text-muted-foreground font-normal">{list.length} 个</span>
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-1">
            角色 fixed_prompt 会注入到所有涉及该角色的镜头 Prompt 中，保证跨集外貌一致
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openCreate}
            disabled={assetLocked}
            className={`px-3.5 py-2 rounded-lg bg-surface2 border border-border text-foreground/80 text-xs hover:border-muted-foreground/50 transition ${lockable}`}
          >
            + 手动新增
          </button>
          <button
            onClick={handleRegenerate}
            disabled={assetLocked || isGenerating}
            className={`px-3.5 py-2 rounded-lg bg-primary/15 border border-primary/40 text-primary text-xs hover:bg-primary/25 transition disabled:opacity-40 ${lockable}`}
          >
            {isGenerating ? "⟳ 生成中..." : "⟳ 全部重新生成"}
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">还没有角色，点击右上方「手动新增」或「全部重新生成」</p>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map(c => {
            const imageUrl = c.portrait_asset_id ? localAssetUrls[c.portrait_asset_id] : null;
            const hasImage = !!imageUrl;

            {/* AI 优化展开态（对照原型 border-2 primary 卡片） */}
            if (optimizingId === c.id) {
              return (
                <div key={c.id} className="bg-card border-2 border-primary rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
                    <span className="text-xs text-primary font-medium">✨ AI 优化中</span>
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono">{c.stable_key}</span>
                  </div>
                  <div className="p-4">
                    <div className="mb-3">
                      <div className="text-xs text-muted-foreground mb-1.5">
                        当前：<span className="text-foreground">{c.name}</span> · {c.role || "未指定"}
                      </div>
                      <p className="text-[11px] text-muted-foreground/80 leading-relaxed bg-surface2 rounded-lg p-2.5 border border-border line-clamp-2">
                        {c.appearance || c.fixed_prompt}
                      </p>
                    </div>
                    <div className="mb-3">
                      <label className="block text-xs text-muted-foreground mb-1.5">优化提示词</label>
                      <textarea
                        rows={3}
                        value={optimizePrompt}
                        onChange={e => setOptimizePrompt(e.target.value)}
                        placeholder="如：让他更有压迫感，增加一个标志性小动作，服装改为中式立领长衫…"
                        className="w-full bg-surface2 border border-primary/40 rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none resize-none leading-relaxed"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOptimize(c.id)}
                        disabled={optimizing}
                        className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition disabled:opacity-50"
                      >
                        {optimizing ? "生成中..." : "生成优化版本"}
                      </button>
                      <button
                        onClick={() => { setOptimizingId(null); setOptimizePrompt(""); }}
                        disabled={optimizing}
                        className="px-3 py-2 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px]"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            {/* 普通卡片（对照原型 asset-card） */}
            return (
              <div
                key={c.id}
                className={`bg-card border border-border rounded-xl overflow-hidden transition ${assetLocked ? "opacity-75" : ""}`}
              >
                {/* 头图区 h-40：有图显示图 + 已上传标；无图显示占位 + 上传按钮（always-on） */}
                <div className="relative h-40 flex items-center justify-center">
                  {hasImage ? (
                    <>
                      <PreviewableImage
                        src={imageUrl!}
                        alt={c.name}
                        className="w-full h-full object-cover"
                        previewCaption={`${c.name} · 角色参考图`}
                      />
                      <span className="absolute top-2.5 left-2.5 text-[10px] px-2 py-0.5 rounded bg-black/60 text-green-400 border border-green-500/30">
                        已上传参考图
                      </span>
                    </>
                  ) : (
                    <div className="w-full h-full bg-surface2 border-b border-border flex flex-col items-center justify-center gap-2">
                      <span className="text-3xl opacity-25">🖼</span>
                      <span className="text-[11px] text-muted-foreground/70">尚未上传参考图</span>
                      <button
                        onClick={() => handleUploadClick(c.id)}
                        disabled={uploadingId === c.id}
                        className={`always-on mt-1 px-3 py-1.5 rounded-lg text-[11px] transition ${
                          assetLocked
                            ? "bg-green-500/15 border border-green-500/50 text-green-400 hover:bg-green-500/25"
                            : "bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25"
                        }`}
                      >
                        {uploadingId === c.id ? "上传中..." : "上传图片"}
                      </button>
                      {assetLocked && (
                        <span className="text-[9px] text-green-400">锁定态下仍可上传 ✓</span>
                      )}
                    </div>
                  )}
                  {/* stable_key + 版本号（右上角 mono） */}
                  <span className="absolute top-2.5 right-2.5 text-[10px] px-2 py-0.5 rounded bg-black/60 text-muted-foreground font-mono">
                    {c.stable_key}
                    {versionMap[c.id] ? ` v${versionMap[c.id]}` : ""}
                  </span>
                </div>

                {/* 内容区 */}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-medium text-foreground">{c.name}</h3>
                    {c.role && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${roleChipClass(c.role)}`}>{c.role}</span>
                    )}
                    {c.is_locked && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-locked/20 text-muted-foreground border border-locked/50">
                        🔒
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/70 ml-auto">
                      {c.age ? `${c.age}岁` : ""}{c.age && c.gender ? " / " : ""}{c.gender || ""}
                    </span>
                  </div>
                  {c.appearance && (
                    <p className="text-xs text-muted-foreground leading-relaxed mb-2 line-clamp-2">
                      {c.appearance}
                    </p>
                  )}
                  {/* 出图提示词（fixed_prompt）：复制去外部平台生成定妆照，再上传回参考图（always-on，锁定态可用）。
                      内容过长时限高内部上下滚动，不撑开卡片 */}
                  <div className="mb-3 flex items-stretch gap-1.5">
                    <p className="flex-1 max-h-24 overflow-y-auto text-[10px] text-muted-foreground/80 font-mono leading-relaxed bg-surface2 rounded-lg p-2 border border-border break-all">
                      {c.fixed_prompt}
                    </p>
                    <button
                      onClick={() => handleCopyPrompt(c)}
                      title="复制出图提示词（fixed_prompt），去外部平台生成角色定妆照"
                      className="always-on shrink-0 px-2 py-1.5 self-start rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition"
                    >
                      📋
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setOptimizingId(c.id); setOptimizePrompt(""); }}
                      disabled={assetLocked}
                      className={`flex-1 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition ${lockable}`}
                    >
                      ✨ AI 优化
                    </button>
                    <button
                      onClick={() => openEdit(c)}
                      className={`flex-1 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition ${lockable}`}
                    >
                      ✎ 手动编辑
                    </button>
                    {hasImage && (
                      <button
                        onClick={() => setReplaceTarget(c)}
                        title="替换参考图：旧图自动失效，引用与已生成提示词不受影响"
                        className="always-on py-1.5 px-2.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition"
                      >
                        🔄 替换图片
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 手动编辑 / 新增 Dialog（含视觉规范、删除入口） */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? (isLockedEditing ? "查看角色（已锁定）" : "编辑角色") : "新增角色"}</DialogTitle>
          </DialogHeader>
          {isLockedEditing && (
            <div className="rounded-lg bg-locked/15 border border-locked/50 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
              🔒 该角色已单独锁定，内容不可修改。锁定期间 AI 重新生成角色时会跳过此角色。
            </div>
          )}
          <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
            {field("name", "名称")}
            {field("role", "角色类型（主角/配角/反派）")}
            {field("gender", "性别")}
            {field("age", "年龄")}
            {field("appearance", "外貌描述", true)}
            {field("personality", "性格", true)}
            {field("background", "背景", true)}
            {field("clothing", "服装", true)}
            <div className="sm:col-span-2">{field("fixed_prompt", "固定视觉 Prompt（一致性锁定）", true)}</div>
            {!isLockedEditing && (
              <div className="sm:col-span-2 flex items-center gap-3">
                <Button type="submit" disabled={loading}>{loading ? "保存中..." : "保存"}</Button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => handleDelete(editing.id)}
                    className="text-destructive hover:underline text-xs"
                  >
                    删除此角色
                  </button>
                )}
              </div>
            )}
          </form>

          {/* 视觉规范（保留既有能力，收入编辑 Dialog） */}
          {editing && (
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">视觉规范（4 类）</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={genSpecsLoading}
                    onClick={() => handleGenSpecs(editing.id)}
                  >
                    {genSpecsLoading ? "生成中..." : "AI 生成"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleShowSpecs(editing.id)}>
                    {specsOpen === editing.id ? "收起" : "查看"}
                  </Button>
                </div>
              </div>
              {specsOpen === editing.id && (
                (specsMap.get(editing.id) || []).length > 0 ? (
                  <div className="space-y-2">
                    {(specsMap.get(editing.id) || []).map((spec, i) => (
                      <div key={i} className="text-xs">
                        <Badge variant="outline" className="mb-1">{spec.spec_name}</Badge>
                        <p className="max-h-24 overflow-y-auto text-[10px] text-muted-foreground font-mono leading-relaxed bg-surface2 rounded-lg p-2 border border-border break-all">
                          {spec.spec_prompt}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">尚未生成视觉规范，点击 &ldquo;AI 生成&rdquo;</p>
                )
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 替换参考图二次确认：后端软删旧 asset 并把引用指针指向新图，提示词内容不受影响 */}
      <Dialog open={!!replaceTarget} onOpenChange={(o) => !o && setReplaceTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>替换参考图</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground leading-relaxed">
            确定替换 <span className="font-medium">{replaceTarget?.name}</span> 的参考图吗？
          </p>
          <ul className="text-xs text-muted-foreground leading-relaxed list-disc pl-4 space-y-1">
            <li>旧图自动失效（软删除），确认后选择新图片上传</li>
            <li>已生成的提示词内容不受影响，引用会自动指向新图</li>
            <li>下游依赖该图的内容（如定妆照缩略图）将显示新图</li>
          </ul>
          <div className="flex justify-end gap-2 mt-1">
            <Button variant="outline" size="sm" onClick={() => setReplaceTarget(null)}>取消</Button>
            <Button
              size="sm"
              onClick={() => {
                if (replaceTarget) handleUploadClick(replaceTarget.id);
                setReplaceTarget(null);
              }}
            >
              选择新图片
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
