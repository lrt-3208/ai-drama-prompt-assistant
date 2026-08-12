"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { usePromptTaskPolling, type PromptTask } from "@/hooks/use-prompt-task-polling";
import { SceneVideoPromptCard } from "@/components/project/scene-video-prompt-card";
import { StylePresetSelector } from "@/components/project/style-preset-selector";
import { ExportDialog } from "@/components/project/export-dialog";
import { StoryboardAssetCard } from "@/components/project/storyboard-asset-card";
import { ContextPreviewDialog } from "@/components/project/context-preview";
import { Collapse, CollapseTrigger, CollapseContent } from "@/components/ui/collapse";
import { Upload, X, Loader2 } from "lucide-react";
import type { StoryboardDocument } from "@/lib/storyboard/document-types";

// ============================================
// 类型定义
// ============================================

interface Shot {
  id: string;
  shot_number: number;
  description: string | null;
  shot_characters?: Array<{ character_id: string }> | null;
}

interface CharacterRef {
  id: string;
  name: string;
  portrait_asset_id: string | null;
}

interface LocationRef {
  id: string;
  name: string;
  reference_asset_id: string | null;
}

interface Scene {
  id: string;
  scene_number: number;
  location_name: string | null;
  location_id: string | null;
  time: string | null;
  shots: Shot[];
}

interface Episode {
  id: string;
  episode_number: number;
  title: string | null;
  summary: string | null;
  scenes: Scene[];
}

interface PromptVersion {
  id: string;
  content: string;
  version_number: number;
  is_current: boolean;
  source: string;
  ai_model: string | null;
  negative_prompt: string | null;
}

interface Prompt {
  id: string;
  shot_id: string | null;
  scene_id: string | null;
  prompt_type: string;
  platform: string;
  language: string;
  source_prompt_id: string | null;
  negative_prompt: string | null;
  quality_score: number | null;
  quality_note: string | null;
  is_stale: boolean;
  prompt_versions: PromptVersion[];
}

interface StoryboardRef {
  id: string;
  scene_id: string;
  status: string;
  version_number: number;
  document: StoryboardDocument | null;
  storyboard_image_asset_id: string | null;
  optimized_image_prompt: string | null;
  is_stale: boolean;
  stale_reason: string | null;
}

interface StoryboardVersionRef {
  id: string;
  storyboard_id: string;
  document: StoryboardDocument;
  version_number: number;
  is_current: boolean;
  source: string;
  ai_model: string | null;
}

interface ShotAssetRef {
  id: string;
  entity_id: string;
}

// ============================================
// 平台配置
// ============================================

interface PlatformConfig {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  capabilities: string[];
  recommended?: boolean;
  lang: string;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: "openai_image",
    name: "GPT 图片生成",
    desc: "高质量人物与场景",
    emoji: "🟢",
    capabilities: ["人物一致性", "电影感", "角色设计"],
    recommended: true,
    lang: "zh",
  },
  {
    id: "jimeng",
    name: "即梦",
    desc: "AI 图片",
    emoji: "🎨",
    capabilities: ["中文优化", "风格化"],
    lang: "zh",
  },
  {
    id: "midjourney",
    name: "Midjourney",
    desc: "风格设计",
    emoji: "🎭",
    capabilities: ["艺术风格", "--ar 参数"],
    lang: "en",
  },
  {
    id: "flux",
    name: "Flux",
    desc: "高保真",
    emoji: "✨",
    capabilities: ["写实", "细节丰富"],
    lang: "en",
  },
  {
    id: "comfyui",
    name: "ComfyUI",
    desc: "工作流",
    emoji: "🔧",
    capabilities: ["权重控制", "Negative Prompt"],
    lang: "zh",
  },
];

// ============================================
// 平台名称查找
// ============================================

function getPlatformName(platformId: string): string {
  const p = PLATFORMS.find((x) => x.id === platformId);
  return p?.name || platformId;
}

// ============================================
// 平台卡片选择器
// ============================================

function PlatformCardSelector({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {PLATFORMS.map((p) => {
        const isSelected = selected === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`relative text-left p-3 rounded-lg border-2 transition-all ${
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            {isSelected && (
              <span className="absolute top-2 right-2 text-primary">✓</span>
            )}
            {p.recommended && (
              <span className="absolute -top-2 -right-2 text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                ⭐
              </span>
            )}
            <div className="text-2xl mb-1">{p.emoji}</div>
            <div className="font-medium text-sm">{p.name}</div>
            <div className="text-xs text-muted-foreground mb-2">{p.desc}</div>
            <div className="flex flex-wrap gap-1">
              {p.capabilities.map((c) => (
                <span
                  key={c}
                  className="text-[10px] bg-muted px-1.5 py-0.5 rounded"
                >
                  {c}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// 角色参考图组件
// ============================================

function CharacterReferenceImage({
  character,
  url,
}: {
  character: CharacterRef;
  url?: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!character.portrait_asset_id) {
    return (
      <div className="flex flex-col items-center gap-1.5 w-20">
        <div className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-[10px] text-muted-foreground">
          无定妆照
        </div>
        <span className="text-xs font-medium text-center truncate w-full">{character.name}</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex flex-col items-center gap-1.5 w-20">
        <div className="w-20 h-20 rounded-lg border-2 border-dashed border-destructive/30 flex items-center justify-center text-[10px] text-muted-foreground">
          加载失败
        </div>
        <span className="text-xs font-medium text-center truncate w-full">{character.name}</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center gap-1.5 w-20">
        <div className="relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={character.name}
            onClick={() => setPreviewOpen(true)}
            className="w-20 h-20 rounded-lg object-cover border cursor-pointer hover:opacity-80 transition-opacity"
          />
        </div>
        <span className="text-xs font-medium text-center truncate w-full">{character.name}</span>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">{character.name} 定妆照</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={character.name} className="w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================
// 场景参考图组件
// ============================================

function SceneReferenceImage({
  location,
  url,
}: {
  location: LocationRef;
  url?: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!location.reference_asset_id) {
    return (
      <div className="flex flex-col items-center gap-1.5 w-20">
        <div className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-[10px] text-muted-foreground">
          无参考图
        </div>
        <span className="text-xs font-medium text-center truncate w-full">{location.name}</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex flex-col items-center gap-1.5 w-20">
        <div className="w-20 h-20 rounded-lg border-2 border-dashed border-destructive/30 flex items-center justify-center text-[10px] text-muted-foreground">
          加载失败
        </div>
        <span className="text-xs font-medium text-center truncate w-full">{location.name}</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center gap-1.5 w-20">
        <div className="relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={location.name}
            onClick={() => setPreviewOpen(true)}
            className="w-20 h-20 rounded-lg object-cover border cursor-pointer hover:opacity-80 transition-opacity"
          />
        </div>
        <span className="text-xs font-medium text-center truncate w-full">{location.name}</span>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">{location.name} 参考图</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={location.name} className="w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================
// 镜头图片缩略图组件（内联上传 + 预览）
// 小尺寸与角色/场景参考图一致，点击预览大图
// ============================================

function ShotImageCell({
  projectId,
  shotId,
  assetId,
  url,
  disabled,
  onUploaded,
  onDeleted,
}: {
  projectId: string;
  shotId: string;
  assetId: string | null;
  url?: string | null;
  disabled?: boolean;
  onUploaded?: (assetId: string, url: string) => void;
  onDeleted?: (assetId: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayUrl = uploadedUrl || url;
  const hasImage = !!assetId && !!displayUrl;

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      formData.append("entityType", "shot");
      formData.append("entityId", shotId);
      formData.append("assetType", "shot_image");
      const res = await fetch("/api/assets/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "上传失败");
      setUploadedUrl(data.url);
      toast.success("图片上传成功");
      onUploaded?.(data.assetId, data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }, [projectId, shotId, onUploaded]);

  const handleDelete = useCallback(async () => {
    if (!assetId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/assets/${assetId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      setUploadedUrl(null);
      toast.success("图片已删除");
      onDeleted?.(assetId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }, [assetId, onDeleted]);

  return (
    <>
      <div className="relative group flex-shrink-0 w-20 h-20">
        {hasImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrl!}
              alt="镜头图片"
              onClick={() => setPreviewOpen(true)}
              className="w-20 h-20 rounded-lg object-cover border cursor-pointer hover:opacity-80 transition-opacity"
            />
            {/* 悬浮删除 */}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              {deleting ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
            </button>
          </>
        ) : (
          <button
            onClick={() => !disabled && inputRef.current?.click()}
            disabled={uploading || disabled}
            className={`w-20 h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-colors ${
              disabled
                ? "border-muted-foreground/20 text-muted-foreground/30 cursor-not-allowed"
                : "border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
            }`}
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Upload className="size-5" />
            )}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />
      {/* 预览大图 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">镜头图片预览</DialogTitle>
          {displayUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={displayUrl} alt="镜头图片" className="w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================
// 主组件
// ============================================

export function PromptWorkbench({
  projectId,
  projectName = "",
  episodes,
  prompts: initialPrompts,
  activePromptTasks,
  characters,
  locations,
  shotAssets,
  storyboards,
  storyboardVersions,
  stylePresetId,
  stylePresets,
  assetUrls = {},
}: {
  projectId: string;
  projectName: string;
  episodes: Episode[] | null;
  prompts: Prompt[] | null;
  activePromptTasks: PromptTask[];
  characters: CharacterRef[];
  locations: LocationRef[];
  shotAssets: ShotAssetRef[];
  storyboards: StoryboardRef[];
  storyboardVersions: StoryboardVersionRef[];
  stylePresetId: string | null;
  stylePresets: Array<{ id: string; name: string; category: string; fixed_prompt: string }>;
  assetUrls?: Record<string, string>;
}) {
  const router = useRouter();

  // === 本地可变状态（乐观更新，替代 router.refresh()） ===
  const [localPrompts, setLocalPrompts] = useState<Prompt[] | null>(initialPrompts);
  const [localShotAssets, setLocalShotAssets] = useState<ShotAssetRef[]>(shotAssets);
  const [localAssetUrls, setLocalAssetUrls] = useState<Record<string, string>>(assetUrls);
  const [localStoryboards, setLocalStoryboards] = useState<StoryboardRef[]>(storyboards);
  const [localStoryboardVersions, setLocalStoryboardVersions] = useState<StoryboardVersionRef[]>(storyboardVersions);

  // 当服务端推送新 props 时（router.refresh() 触发的 RSC 重渲染），同步到本地状态
  const prevPropsRef = useRef({ initialPrompts, shotAssets, assetUrls, storyboards, storyboardVersions });
  useEffect(() => {
    const prev = prevPropsRef.current;
    if (prev.initialPrompts !== initialPrompts) setLocalPrompts(initialPrompts);
    if (prev.shotAssets !== shotAssets) setLocalShotAssets(shotAssets);
    if (prev.assetUrls !== assetUrls) setLocalAssetUrls(assetUrls);
    if (prev.storyboards !== storyboards) setLocalStoryboards(storyboards);
    if (prev.storyboardVersions !== storyboardVersions) setLocalStoryboardVersions(storyboardVersions);
    prevPropsRef.current = { initialPrompts, shotAssets, assetUrls, storyboards, storyboardVersions };
  }, [initialPrompts, shotAssets, assetUrls, storyboards, storyboardVersions]);

  // === 乐观更新处理函数 ===

  // 镜头图片上传成功
  const handleShotImageUploaded = useCallback((shotId: string, assetId: string, url: string) => {
    setLocalShotAssets(prev => {
      const filtered = prev.filter(a => a.entity_id !== shotId);
      return [...filtered, { id: assetId, entity_id: shotId }];
    });
    setLocalAssetUrls(prev => ({ ...prev, [assetId]: url }));
  }, []);

  // 镜头图片删除成功
  const handleShotImageDeleted = useCallback((assetId: string) => {
    setLocalShotAssets(prev => prev.filter(a => a.id !== assetId));
  }, []);

  const { isShotGenerating, isSceneGenerating, isPromptEvaluating, createPromptTask, createSceneTask, createPromptEvalTask } = usePromptTaskPolling({
    projectId,
    initialTasks: activePromptTasks,
    onTaskDone: (_id, taskType, status) => {
      if (status === "success") {
        if (taskType === "generate_storyboard_asset") toast.success("Storyboard 生成成功");
        else if (taskType === "generate_scene_video_prompt") toast.success("场景视频 Prompt 生成成功");
        else if (taskType === "generate_storyboard_image") toast.success("粗稿图片和优化提示词已生成");
        else if (taskType === "evaluate_prompt") toast.success("Prompt 质量评分完成");
        else toast.success("图片 Prompt 生成成功");
      } else {
        if (taskType === "generate_storyboard_asset") toast.error("Storyboard 生成失败");
        else if (taskType === "generate_scene_video_prompt") toast.error("场景视频 Prompt 生成失败");
        else if (taskType === "generate_storyboard_image") toast.error("粗稿图片生成失败");
        else if (taskType === "evaluate_prompt") toast.error("质量评分失败");
        else toast.error("图片 Prompt 生成失败");
      }
      router.refresh();
    },
  });
  const [detailShotId, setDetailShotId] = useState<string | null>(null);
  const [detailShotData, setDetailShotData] = useState<{
    shotId: string;
    shotNumber: number;
    description: string;
    sceneLocation: string;
    characterIds: string[];
    locationId: string | null;
  } | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");
  const [showPlatformDialog, setShowPlatformDialog] = useState(false);
  const [targetShotId, setTargetShotId] = useState<string | null>(null);
  const [switchingVersion, setSwitchingVersion] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState<string | null>(null);
  const [showContextPreview, setShowContextPreview] = useState(false);
  const [contextPreviewShotId, setContextPreviewShotId] = useState<string | null>(null);
  const [contextPreviewSceneId, setContextPreviewSceneId] = useState<string | null>(null);
  const [contextPreviewPlatform, setContextPreviewPlatform] = useState<string | null>(null);
  const [contextPreviewLanguage, setContextPreviewLanguage] = useState<string | null>(null);
  const [contextPreviewMode, setContextPreviewMode] = useState<string | null>(null);
  const [localEvaluatingId, setLocalEvaluatingId] = useState<string | null>(null);

  // 按 shot_id 分组 prompts（跳过 scene 级 prompt）
  const promptsByShot = useMemo(() => {
    const map = new Map<string, Prompt[]>();
    if (localPrompts) {
      for (const p of localPrompts) {
        if (!p.shot_id) continue;
        const list = map.get(p.shot_id) || [];
        list.push(p);
        map.set(p.shot_id, list);
      }
    }
    return map;
  }, [localPrompts]);

  // 按 scene_id 分组 scene_video prompts
  const promptsByScene = useMemo(() => {
    const map = new Map<string, Prompt[]>();
    if (localPrompts) {
      for (const p of localPrompts) {
        if (!p.scene_id || p.prompt_type !== "scene_video") continue;
        const list = map.get(p.scene_id) || [];
        list.push(p);
        map.set(p.scene_id, list);
      }
    }
    return map;
  }, [localPrompts]);

  // 构建 shot_id → asset_id 映射
  const shotAssetMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of localShotAssets) {
      if (!map.has(a.entity_id)) {
        map.set(a.entity_id, a.id);
      }
    }
    return map;
  }, [localShotAssets]);

  // 构建 scene_id → storyboard 映射
  const storyboardMap = useMemo(() => {
    const map = new Map<string, StoryboardRef>();
    for (const sb of localStoryboards) {
      map.set(sb.scene_id, sb);
    }
    return map;
  }, [localStoryboards]);

  // 构建 storyboard_id → versions[] 映射
  const storyboardVersionsMap = useMemo(() => {
    const map = new Map<string, StoryboardVersionRef[]>();
    for (const v of localStoryboardVersions) {
      const list = map.get(v.storyboard_id) || [];
      list.push(v);
      map.set(v.storyboard_id, list);
    }
    return map;
  }, [localStoryboardVersions]);

  // 构建 character id → CharacterRef 映射
  const characterMap = useMemo(() => {
    const map = new Map<string, CharacterRef>();
    for (const c of characters) {
      map.set(c.id, c);
    }
    return map;
  }, [characters]);

  // 构建 location id → LocationRef 映射
  const locationMap = useMemo(() => {
    const map = new Map<string, LocationRef>();
    for (const l of locations) {
      map.set(l.id, l);
    }
    return map;
  }, [locations]);

  const getCurrentVersion = (prompt: Prompt): PromptVersion | null => {
    const current = prompt.prompt_versions?.find((v) => v.is_current);
    return current || prompt.prompt_versions?.[0] || null;
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const handleSwitchVersion = async (promptId: string, versionId: string) => {
    setSwitchingVersion(versionId);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/prompts/${promptId}/versions`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "切换版本失败");
        return;
      }
      toast.success("已切换到该版本");
      // 乐观更新：本地翻转 is_current 标记，不触发 router.refresh()
      setLocalPrompts(prev => {
        if (!prev) return prev;
        return prev.map(p => {
          if (p.id !== promptId) return p;
          return {
            ...p,
            prompt_versions: p.prompt_versions.map(v => ({
              ...v,
              is_current: v.id === versionId,
            })),
          };
        });
      });
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSwitchingVersion(null);
    }
  };

  // 场景级生成处理器（Storyboard / 场景视频 Prompt / 质量评分）
  const handleGenerateStoryboard = async (sceneId: string) => {
    toast.info("正在生成 Storyboard 资产，通常需要 30-60 秒...");
    try {
      await createSceneTask("generate_storyboard_asset", sceneId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  const handleGenerateSceneVideo = async (sceneId: string) => {
    toast.info("正在生成场景视频 Prompt，通常需要 30-60 秒...");
    try {
      await createSceneTask("generate_scene_video_prompt", sceneId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  const handleEvaluatePrompt = async (promptId: string) => {
    setLocalEvaluatingId(promptId);
    toast.info("正在评估 Prompt 质量...");
    try {
      await createPromptEvalTask(promptId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建评估任务失败");
    } finally {
      // 轮询会接管状态，本地状态延迟清除避免按钮闪烁
      setTimeout(() => setLocalEvaluatingId(null), 3000);
    }
  };

  // 打开平台选择 Dialog
  const openPlatformDialog = (shotId: string) => {
    setTargetShotId(shotId);
    setSelectedPlatform("");
    setShowPlatformDialog(true);
  };

  // 生成 Prompt
  const handleGenerate = async () => {
    if (!targetShotId || !selectedPlatform) {
      toast.error("请选择平台");
      return;
    }

    const platform = PLATFORMS.find((p) => p.id === selectedPlatform);
    if (!platform) return;

    setShowPlatformDialog(false);
    toast.info("AI 生成中，通常需要 30-60 秒，可同时生成其他镜头...");
    try {
      await createPromptTask(targetShotId, "image", selectedPlatform, platform.lang);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // 打开详情 Dialog
  const openDetail = (
    shotId: string,
    shotNumber: number,
    description: string,
    sceneLocation: string,
    characterIds: string[],
    locationId: string | null
  ) => {
    setDetailShotData({ shotId, shotNumber, description, sceneLocation, characterIds, locationId });
    setDetailShotId(shotId);
  };

  if (!episodes || episodes.length === 0) {
    return (
      <div className="max-w-6xl">
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-1">Prompt 工作台</h2>
          <p className="text-sm text-muted-foreground">
            基于分镜、角色、场景、视觉风格，生成图片 Prompt。
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-lg">
          <p className="text-muted-foreground">请先生成分镜后再生成 Prompt</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Prompt 工作台</h2>
          <div className="flex items-center gap-2">
            <StylePresetSelector projectId={projectId} currentPresetId={stylePresetId} presets={stylePresets} />
            <ExportDialog projectId={projectId} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          基于分镜、角色、场景、视觉风格，生成图片 Prompt 与场景视频 Prompt。
        </p>
      </div>

      {episodes.map((ep, epIdx) => (
        <Card key={ep.id} className="mb-3 border-l-4 border-l-primary/40 overflow-hidden py-0 gap-0">
          <Collapse defaultOpen={epIdx === 0}>
            <CollapseTrigger className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40">
              <Badge className="text-sm">第 {ep.episode_number} 集</Badge>
              {ep.title && <span className="font-medium text-sm">{ep.title}</span>}
              <span className="text-xs text-muted-foreground ml-auto">
                {ep.scenes?.length || 0} 场景 · {(ep.scenes || []).reduce((acc, sc) => acc + (sc.shots?.length || 0), 0)} 镜头
              </span>
            </CollapseTrigger>
            <CollapseContent className="px-4 pb-4 pt-2">

            {ep.scenes?.map((sc, scIdx) => (
              <div
                key={sc.id}
                className={`mb-5 last:mb-0 pl-4 border-l-2 border-l-muted ${scIdx > 0 ? "mt-4" : ""}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-semibold text-sm bg-muted px-2 py-0.5 rounded">
                    场景 {sc.scene_number}
                  </span>
                  {sc.location_name && (
                    <Badge variant="secondary" className="text-xs">
                      {sc.location_name}
                    </Badge>
                  )}
                  {sc.time && (
                    <span className="text-xs text-muted-foreground">{sc.time}</span>
                  )}
                </div>

                {/* 镜头卡片列表 */}
                {sc.shots?.map((sh) => {
                  const shotPrompts = promptsByShot.get(sh.id) || [];
                  const imagePrompts = shotPrompts.filter((p) => p.prompt_type === "image");
                  const hasImage = imagePrompts.length > 0;
                  const isImageGenerating = isShotGenerating(sh.id, "image");

                  // 获取平台名
                  const imagePlatform = hasImage
                    ? getPlatformName(imagePrompts[0].platform)
                    : "";

                  return (
                    <div
                      key={sh.id}
                      className="bg-muted/20 rounded-lg p-3 mb-2 last:mb-0 ml-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-muted-foreground min-w-[3rem]">
                          镜头 {sh.shot_number}
                        </span>

                        {/* 镜头图片缩略图/上传（未生成 Prompt 时禁用） */}
                        <ShotImageCell
                          projectId={projectId}
                          shotId={sh.id}
                          assetId={shotAssetMap.get(sh.id) || null}
                          url={localAssetUrls[shotAssetMap.get(sh.id) || ""] || null}
                          disabled={!hasImage}
                          onUploaded={(assetId, url) => handleShotImageUploaded(sh.id, assetId, url)}
                          onDeleted={handleShotImageDeleted}
                        />

                        <p className="text-sm flex-1 truncate">
                          {sh.description || "(无描述)"}
                        </p>
                        <div className="flex items-center gap-2 text-xs">
                          {isImageGenerating ? (
                            <span className="text-primary animate-pulse">图片生成中...</span>
                          ) : hasImage ? (
                            <Badge variant="default" className="text-xs gap-1">
                              {imagePlatform}
                            </Badge>
                          ) : (
                            <button
                              onClick={() => openPlatformDialog(sh.id)}
                              className="text-primary hover:underline"
                            >
                              生成图片
                            </button>
                          )}
                        </div>

                        {/* 查看详情 */}
                        <button
                          onClick={() =>
                            openDetail(
                              sh.id,
                              sh.shot_number,
                              sh.description || "",
                              sc.location_name || "",
                              (sh.shot_characters || []).map((sc) => sc.character_id),
                              sc.location_id || null
                            )
                          }
                          className="text-xs text-primary hover:underline ml-auto"
                        >
                          {shotPrompts.length > 0 ? "查看详情" : "详情"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                
                {/* 场景视频 Prompt 卡片 + 图片依赖面板 */}
                {(() => {
                  const svPrompts = promptsByScene.get(sc.id) || [];
                  const svPrompt = svPrompts[0] || null;
                  const sb = storyboardMap.get(sc.id);
                  const shotIds = (sc.shots || []).map((s) => s.id);
                  const missingShotNums = (sc.shots || [])
                    .filter((s) => !shotAssetMap.has(s.id))
                    .map((s) => s.shot_number);
                  // Storyboard 文档不依赖 shot_image，只要有镜头就 ready
                  const storyboardReady = (sc.shots || []).length > 0;
                  // Scene Video Prompt 硬依赖：① Storyboard Document 已生成(status='ready') ② 全部镜头已回传 shot_image
                  const sceneReady = !!sb && sb.status === "ready" && missingShotNums.length === 0 && (sc.shots || []).length > 0;
      
                  // 构建图片依赖数据
                  const charIds = new Set<string>();
                  for (const sh of sc.shots || []) {
                    for (const sc of sh.shot_characters || []) {
                      charIds.add(sc.character_id);
                    }
                  }
                  const depChars = Array.from(charIds).map((cid) => {
                    const c = characterMap.get(cid);
                    return { asset_id: c?.portrait_asset_id || null, name: c?.name || "未知" };
                  });
                  const depLocs = sc.location_id && locationMap.get(sc.location_id)
                    ? [{ asset_id: locationMap.get(sc.location_id)!.reference_asset_id, name: locationMap.get(sc.location_id)!.name }]
                    : [];
                  const depShots = (sc.shots || []).map((sh) => ({
                    asset_id: shotAssetMap.get(sh.id) || null,
                    name: sh.description || `镜头${sh.shot_number}`,
                    shot_number: sh.shot_number,
                  }));
      
                  // 构建依赖图片缩略图列表（角色定妆照 + 场景参考图 + 故事板优化图片 + 镜头图片）
                  const docStoryboardImageUrl = sb?.storyboard_image_asset_id ? (localAssetUrls[sb.storyboard_image_asset_id] || null) : null;
                  const depImages: { url: string; label: string; kind: "character" | "location" | "shot" | "storyboard" }[] = [
                    ...depChars.filter((c) => c.asset_id && localAssetUrls[c.asset_id!]).map((c) => ({ url: localAssetUrls[c.asset_id!]!, label: c.name, kind: "character" as const })),
                    ...depLocs.filter((l) => l.asset_id && localAssetUrls[l.asset_id!]).map((l) => ({ url: localAssetUrls[l.asset_id!]!, label: l.name, kind: "location" as const })),
                    ...(docStoryboardImageUrl ? [{ url: docStoryboardImageUrl, label: "故事板", kind: "storyboard" as const }] : []),
                    ...depShots.filter((s) => s.asset_id && localAssetUrls[s.asset_id!]).map((s) => ({ url: localAssetUrls[s.asset_id!]!, label: `镜${s.shot_number}`, kind: "shot" as const })),
                  ];

                  // 构建 Storyboard 文档预览数据
                  const locRef = sc.location_id ? locationMap.get(sc.location_id) : null;
                  const docCharacters: import("@/lib/storyboard/document-types").CharacterRef[] = Array.from(charIds).map(cid => {
                    const c = characterMap.get(cid);
                    const assetId = c?.portrait_asset_id;
                    return {
                      name: c?.name || "未知",
                      role: null,
                      portraitUrl: assetId && localAssetUrls[assetId] ? localAssetUrls[assetId] : null,
                      description: "",
                    };
                  });
                  const docLocationImageUrl = locRef?.reference_asset_id ? (localAssetUrls[locRef.reference_asset_id] || null) : null;
                  const docFrameImages: Record<number, string> = {};
                  for (const sh of sc.shots || []) {
                    const assetId = shotAssetMap.get(sh.id);
                    if (assetId && localAssetUrls[assetId]) {
                      docFrameImages[sh.shot_number] = localAssetUrls[assetId];
                    }
                  }
                  const docEpisodeTitle = `第 ${ep.episode_number} 集${ep.title ? " · " + ep.title : ""}`;
                  const docLocationName = sc.location_name || locRef?.name || "";

                  return (
                    <div className="mt-3 space-y-2">
                      <StoryboardAssetCard
                        projectId={projectId}
                        sceneId={sc.id}
                        sceneNumber={sc.scene_number}
                        storyboard={sb ?? null}
                        storyboardImageUrl={docStoryboardImageUrl}
                        storyboardVersions={sb ? (storyboardVersionsMap.get(sb.id) || []) : []}
                        missingShots={missingShotNums}
                        ready={storyboardReady}
                        isGenerating={isSceneGenerating(sc.id, "generate_storyboard_asset")}
                        isImageGenerating={isSceneGenerating(sc.id, "generate_storyboard_image")}
                        onGenerate={() => handleGenerateStoryboard(sc.id)}
                        projectName={projectName}
                        episodeTitle={docEpisodeTitle}
                        locationName={docLocationName}
                        totalShots={(sc.shots || []).length}
                        characters={docCharacters}
                        locationImageUrl={docLocationImageUrl}
                        frameImages={docFrameImages}
                        onSwitchVersion={sb ? (async (versionId: string) => {
                          try {
                            const res = await fetch(`/api/projects/${projectId}/storyboards/${sc.id}/versions`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ versionId }),
                            });
                            if (!res.ok) throw new Error("切换版本失败");
                            toast.success("已切换到该版本");
                            // 乐观更新：本地翻转 storyboard 版本 is_current
                            setLocalStoryboardVersions(prev => prev.map(v => {
                              if (v.storyboard_id !== sb.id) return v;
                              return { ...v, is_current: v.id === versionId };
                            }));
                          } catch {
                            toast.error("切换版本失败");
                          }
                        }) : undefined}
                        dependencyImages={depImages}
                      />
                      <SceneVideoPromptCard
                        sceneId={sc.id}
                        projectId={projectId}
                        sceneNumber={sc.scene_number}
                        locationName={sc.location_name}
                        sceneVideoPrompt={svPrompt as never}
                        storyboardStatus={sb?.status || null}
                        ready={sceneReady}
                        missingShots={missingShotNums}
                        isGenerating={isSceneGenerating(sc.id, "generate_scene_video_prompt")}
                        isEvaluating={svPrompt ? isPromptEvaluating(svPrompt.id) : false}
                        onGenerate={() => handleGenerateSceneVideo(sc.id)}
                        onEvaluate={() => svPrompt && handleEvaluatePrompt(svPrompt.id)}
                        onSwitchVersion={(versionId) => svPrompt && handleSwitchVersion(svPrompt.id, versionId)}
                        dependencyImages={depImages}
                        onPreviewContext={() => {
                          setContextPreviewSceneId(sc.id);
                          setContextPreviewShotId(null);
                          setContextPreviewPlatform(svPrompt?.platform || "jimeng");
                          setContextPreviewLanguage(svPrompt?.language || "zh");
                          setContextPreviewMode(null);
                          setShowContextPreview(true);
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
            ))}
            </CollapseContent>
          </Collapse>
        </Card>
      ))}

      {/* 平台选择 Dialog */}
      <Dialog
        open={showPlatformDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowPlatformDialog(false);
            setSelectedPlatform("");
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              选择图片生成平台
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <PlatformCardSelector
              selected={selectedPlatform}
              onSelect={setSelectedPlatform}
            />
            <Button
              onClick={handleGenerate}
              disabled={!selectedPlatform}
              className="mt-4 w-full"
            >
              生成
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 详情 Dialog */}
      <Dialog
        open={detailShotId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailShotId(null);
            setDetailShotData(null);
            setShowVersions(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              镜头 {detailShotData?.shotNumber} 详情
              {detailShotData?.sceneLocation && ` · ${detailShotData.sceneLocation}`}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {detailShotData?.description && (
              <p className="text-sm text-muted-foreground mb-4">
                {detailShotData.description}
              </p>
            )}

            {/* 角色参考图 */}
            {(() => {
              if (!detailShotData) return null;
              const shotChars = (detailShotData.characterIds || [])
                .map((id) => characterMap.get(id))
                .filter((c): c is CharacterRef => !!c);

              if (shotChars.length === 0) return null;

              return (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold mb-3 pb-2 border-b">
                    角色参考图
                  </h4>
                  <div className="flex flex-wrap gap-4">
                    {shotChars.map((c) => (
                      <CharacterReferenceImage key={c.id} character={c} url={localAssetUrls[c.portrait_asset_id!]} />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 场景参考图 */}
            {(() => {
              if (!detailShotData?.locationId) return null;
              const loc = locationMap.get(detailShotData.locationId);
              if (!loc) return null;

              return (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold mb-3 pb-2 border-b">
                    场景参考图
                  </h4>
                  <div className="flex flex-wrap gap-4">
                    <SceneReferenceImage location={loc} url={localAssetUrls[loc.reference_asset_id!]} />
                  </div>
                </div>
              );
            })()}

            {/* 镜头图片（与列表一致的缩略图尺寸） */}
            <div className="mb-6">
              <h4 className="text-sm font-semibold mb-3 pb-2 border-b">镜头图片</h4>
              {detailShotData && (() => {
                const detailShotPrompts = promptsByShot.get(detailShotData.shotId) || [];
                const detailHasImage = detailShotPrompts.some((p) => p.prompt_type === "image");
                return (
                  <ShotImageCell
                    projectId={projectId}
                    shotId={detailShotData.shotId}
                    assetId={shotAssetMap.get(detailShotData.shotId) || null}
                    url={localAssetUrls[shotAssetMap.get(detailShotData.shotId) || ""] || null}
                    disabled={!detailHasImage}
                    onUploaded={(assetId, url) => handleShotImageUploaded(detailShotData.shotId, assetId, url)}
                    onDeleted={handleShotImageDeleted}
                  />
                );
              })()}
            </div>

            {/* 图片生成区域 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3 pb-2 border-b">
                <h4 className="text-sm font-semibold">图片生成</h4>
              </div>
              {(() => {
                if (!detailShotData) return null;
                const shotPrompts = promptsByShot.get(detailShotData.shotId) || [];
                const imagePrompts = shotPrompts.filter((p) => p.prompt_type === "image");

                if (imagePrompts.length === 0) {
                  return (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">未生成</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDetailShotId(null);
                          openPlatformDialog(detailShotData.shotId);
                        }}
                      >
                        选择平台生成
                      </Button>
                    </div>
                  );
                }

                return imagePrompts.map((p) => {
                  const version = getCurrentVersion(p);
                  const hasMultipleVersions = (p.prompt_versions?.length || 0) > 1;
                  return (
                    <div key={p.id} className="bg-background border rounded p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="default" className="text-xs">
                          {getPlatformName(p.platform)}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {p.language === "zh" ? "中文" : "英文"}
                        </Badge>
                        {version && (
                          <span className="text-xs text-muted-foreground">
                            v{version.version_number}
                            {version.source === "ai" && ` · ${version.ai_model || "AI"}`}
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                          {version && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => handleCopy(version.content)}
                            >
                              复制
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            onClick={() => handleEvaluatePrompt(p.id)}
                            disabled={isPromptEvaluating(p.id) || localEvaluatingId === p.id}
                          >
                            {isPromptEvaluating(p.id) || localEvaluatingId === p.id ? "评分中..." : "质量评分"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            onClick={() => {
                              setContextPreviewShotId(detailShotData.shotId);
                              setContextPreviewSceneId(null);
                              setContextPreviewPlatform(p.platform || "jimeng");
                              setContextPreviewLanguage(p.language || "zh");
                              setContextPreviewMode(null);
                              setShowContextPreview(true);
                            }}
                          >
                            🔍 调试信息
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            onClick={() => {
                              setDetailShotId(null);
                              openPlatformDialog(detailShotData.shotId);
                            }}
                          >
                            重新生成
                          </Button>
                          {hasMultipleVersions && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() =>
                                setShowVersions(
                                  showVersions === p.id ? null : p.id
                                )
                              }
                            >
                              {showVersions === p.id ? "收起" : `历史(${p.prompt_versions.length})`}
                            </Button>
                          )}
                        </div>
                      </div>
                      {/* 质量评分结果 */}
                      {p.quality_score && (
                        <div className="mb-2 flex items-center gap-2 text-xs">
                          <Badge
                            variant="outline"
                            className={
                              p.quality_score >= 4
                                ? "text-green-600 border-green-500/40"
                                : p.quality_score >= 3
                                ? "text-amber-500 border-amber-500/40"
                                : "text-red-500 border-red-500/40"
                            }
                          >
                            质量 {p.quality_score}/5
                          </Badge>
                          {p.quality_note && (
                            <span className="text-muted-foreground">{p.quality_note}</span>
                          )}
                        </div>
                      )}
                      {version && (
                        <p className="text-sm font-mono whitespace-pre-wrap break-all bg-muted/30 p-2 rounded">
                          {version.content}
                        </p>
                      )}
                      {/* 版本历史 */}
                      {showVersions === p.id && hasMultipleVersions && (
                        <div className="mt-2 border-t pt-2 flex flex-col gap-1">
                          {p.prompt_versions.map((v) => (
                            <div key={v.id} className="flex items-start gap-2 text-xs">
                              <span className="font-medium min-w-[2rem]">v{v.version_number}</span>
                              {v.is_current && (
                                <Badge variant="default" className="text-xs h-5">当前</Badge>
                              )}
                              <span className="text-muted-foreground">
                                {v.source === "ai" ? v.ai_model || "AI" : "手动"}
                              </span>
                              {!v.is_current && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 text-xs ml-auto"
                                  disabled={switchingVersion === v.id}
                                  onClick={() => handleSwitchVersion(p.id, v.id)}
                                >
                                  {switchingVersion === v.id ? "切换中..." : "切换"}
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

          </div>
        </DialogContent>
      </Dialog>

      {/* 上下文调试预览 Dialog */}
      <ContextPreviewDialog
        projectId={projectId}
        open={showContextPreview}
        onOpenChange={setShowContextPreview}
        shotId={contextPreviewShotId}
        sceneId={contextPreviewSceneId}
        platform={contextPreviewPlatform}
        language={contextPreviewLanguage}
        mode={contextPreviewMode}
      />

    </div>
  );
}