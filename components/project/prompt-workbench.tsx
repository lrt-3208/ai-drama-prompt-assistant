"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { usePromptTaskPolling, type PromptTask } from "@/hooks/use-prompt-task-polling";

// ============================================
// 类型定义
// ============================================

interface Shot {
  id: string;
  shot_number: number;
  description: string | null;
}

interface Scene {
  id: string;
  scene_number: number;
  location_name: string | null;
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
}

interface Prompt {
  id: string;
  shot_id: string;
  prompt_type: string;
  platform: string;
  language: string;
  source_prompt_id: string | null;
  prompt_versions: PromptVersion[];
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

const PLATFORMS: Record<"image" | "video", PlatformConfig[]> = {
  image: [
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
  ],
  video: [
    {
      id: "doubao_video",
      name: "豆包视频",
      desc: "视频生成",
      emoji: "🎬",
      capabilities: ["运动连续", "中文描述"],
      recommended: true,
      lang: "zh",
    },
    {
      id: "jimeng_video",
      name: "即梦视频",
      desc: "AI 视频",
      emoji: "🎥",
      capabilities: ["画面过渡", "动作流畅"],
      lang: "zh",
    },
    {
      id: "kling",
      name: "可灵",
      desc: "运动生成",
      emoji: "🌊",
      capabilities: ["镜头运动", "环境变化"],
      lang: "zh",
    },
    {
      id: "runway",
      name: "Runway",
      desc: "专业视频",
      emoji: "🛤️",
      capabilities: ["Motion Brush", "英文描述"],
      lang: "en",
    },
    {
      id: "ltx",
      name: "LTX",
      desc: "快速生成",
      emoji: "⚡",
      capabilities: ["简洁", "核心运动"],
      lang: "zh",
    },
  ],
};

// ============================================
// 平台名称查找
// ============================================

function getPlatformName(type: "image" | "video", platformId: string): string {
  const p = PLATFORMS[type].find((x) => x.id === platformId);
  return p?.name || platformId;
}

// ============================================
// 平台卡片选择器
// ============================================

function PlatformCardSelector({
  type,
  selected,
  onSelect,
}: {
  type: "image" | "video";
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {PLATFORMS[type].map((p) => {
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
// 主组件
// ============================================

export function PromptWorkbench({
  projectId,
  episodes,
  prompts: initialPrompts,
  activePromptTasks,
}: {
  projectId: string;
  episodes: Episode[] | null;
  prompts: Prompt[] | null;
  activePromptTasks: PromptTask[];
}) {
  const router = useRouter();
  const { isShotGenerating, createPromptTask } = usePromptTaskPolling({
    projectId,
    initialTasks: activePromptTasks,
    onTaskDone: (_shotId, promptType, status) => {
      if (status === "success") toast.success(`${promptType === "image" ? "图片" : "视频"} Prompt 生成成功`);
      else toast.error(`${promptType === "image" ? "图片" : "视频"} Prompt 生成失败`);
      router.refresh();
    },
  });
  const [detailShotId, setDetailShotId] = useState<string | null>(null);
  const [detailShotData, setDetailShotData] = useState<{
    shotId: string;
    shotNumber: number;
    description: string;
    sceneLocation: string;
  } | null>(null);
  const [genType, setGenType] = useState<"image" | "video">("image");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");
  const [showPlatformDialog, setShowPlatformDialog] = useState(false);
  const [platformDialogType, setPlatformDialogType] = useState<"image" | "video">("image");
  const [targetShotId, setTargetShotId] = useState<string | null>(null);
  const [switchingVersion, setSwitchingVersion] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState<string | null>(null);

  // 按 shot_id 分组 prompts
  const promptsByShot = useMemo(() => {
    const map = new Map<string, Prompt[]>();
    if (initialPrompts) {
      for (const p of initialPrompts) {
        const list = map.get(p.shot_id) || [];
        list.push(p);
        map.set(p.shot_id, list);
      }
    }
    return map;
  }, [initialPrompts]);

  // 构建 source_prompt_id → platform 映射（用于显示来源信息）
  const sourcePromptMap = useMemo(() => {
    const map = new Map<string, { platform: string; version: number }>();
    if (initialPrompts) {
      for (const p of initialPrompts) {
        if (p.prompt_type === "image") {
          const current = p.prompt_versions?.find((v) => v.is_current);
          map.set(p.id, {
            platform: getPlatformName("image", p.platform),
            version: current?.version_number || 1,
          });
        }
      }
    }
    return map;
  }, [initialPrompts]);

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
      router.refresh();
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSwitchingVersion(null);
    }
  };

  // 打开平台选择 Dialog
  const openPlatformDialog = (shotId: string, type: "image" | "video") => {
    setTargetShotId(shotId);
    setPlatformDialogType(type);
    setGenType(type);
    setSelectedPlatform("");
    setShowPlatformDialog(true);
  };

  // 生成 Prompt
  const handleGenerate = async () => {
    if (!targetShotId || !selectedPlatform) {
      toast.error("请选择平台");
      return;
    }

    const platform = PLATFORMS[genType].find((p) => p.id === selectedPlatform);
    if (!platform) return;

    setShowPlatformDialog(false);
    toast.info("AI 生成中，通常需要 30-60 秒，可同时生成其他镜头...");
    try {
      await createPromptTask(targetShotId, genType, selectedPlatform, platform.lang);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // 打开详情 Dialog
  const openDetail = (
    shotId: string,
    shotNumber: number,
    description: string,
    sceneLocation: string
  ) => {
    setDetailShotData({ shotId, shotNumber, description, sceneLocation });
    setDetailShotId(shotId);
  };

  if (!episodes || episodes.length === 0) {
    return (
      <div className="max-w-6xl">
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-1">Prompt 工作台</h2>
          <p className="text-sm text-muted-foreground">
            基于分镜、角色、场景、视觉风格，生成图片 Prompt 和视频 Prompt。
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
        <h2 className="text-lg font-semibold mb-1">Prompt 工作台</h2>
        <p className="text-sm text-muted-foreground">
          图片生成 → 视频生成。视频 Prompt 依赖图片 Prompt（任意平台）。
        </p>
      </div>

      {episodes.map((ep) => (
        <Card key={ep.id} className="mb-6 border-l-4 border-l-primary/40">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-4">
              <Badge className="text-sm">第 {ep.episode_number} 集</Badge>
              {ep.title && <span className="font-medium text-sm">{ep.title}</span>}
            </div>

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
                  const videoPrompts = shotPrompts.filter((p) => p.prompt_type === "video");
                  const hasImage = imagePrompts.length > 0;
                  const hasVideo = videoPrompts.length > 0;
                  const isImageGenerating = isShotGenerating(sh.id, "image");
                  const isVideoGenerating = isShotGenerating(sh.id, "video");

                  // 获取平台名
                  const imagePlatform = hasImage
                    ? getPlatformName("image", imagePrompts[0].platform)
                    : "";
                  const videoPlatform = hasVideo
                    ? getPlatformName("video", videoPrompts[0].platform)
                    : "";

                  return (
                    <div
                      key={sh.id}
                      className="bg-muted/20 rounded-lg p-3 mb-2 last:mb-0 ml-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            镜头 {sh.shot_number}
                          </span>
                          {sh.description && (
                            <p className="text-sm mt-1">{sh.description}</p>
                          )}
                        </div>
                      </div>

                      {/* 状态行 */}
                      <div className="flex items-center gap-4 mt-2">
                        {/* 图片状态 */}
                        <div className="flex items-center gap-1 text-xs">
                          <span>🖼</span>
                          {hasImage ? (
                            <span className="text-green-600">✓ {imagePlatform}</span>
                          ) : isImageGenerating ? (
                            <span className="text-amber-600">生成中...</span>
                          ) : (
                            <button
                              onClick={() => openPlatformDialog(sh.id, "image")}
                              className="text-primary hover:underline"
                            >
                              生成图片
                            </button>
                          )}
                        </div>

                        {/* 视频状态 */}
                        <div className="flex items-center gap-1 text-xs">
                          <span>🎬</span>
                          {hasVideo ? (
                            <span className="text-green-600">✓ {videoPlatform}</span>
                          ) : isVideoGenerating ? (
                            <span className="text-amber-600">生成中...</span>
                          ) : hasImage ? (
                            <button
                              onClick={() => openPlatformDialog(sh.id, "video")}
                              className="text-primary hover:underline"
                            >
                              生成视频
                            </button>
                          ) : (
                            <span className="text-muted-foreground">🔒 等待图片</span>
                          )}
                        </div>

                        {/* 查看详情 */}
                        {shotPrompts.length > 0 && (
                          <button
                            onClick={() =>
                              openDetail(
                                sh.id,
                                sh.shot_number,
                                sh.description || "",
                                sc.location_name || ""
                              )
                            }
                            className="text-xs text-primary hover:underline ml-auto"
                          >
                            查看详情
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
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
              选择{platformDialogType === "image" ? "图片" : "视频"}生成平台
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <PlatformCardSelector
              type={platformDialogType}
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

            {/* 图片生成区域 */}
            <div className="mb-6">
              <h4 className="text-sm font-semibold mb-3 pb-2 border-b">图片生成</h4>
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
                          openPlatformDialog(detailShotData.shotId, "image");
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
                          {getPlatformName("image", p.platform)}
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
                            onClick={() => {
                              setDetailShotId(null);
                              openPlatformDialog(detailShotData.shotId, "image");
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

            {/* 视频生成区域 */}
            <div>
              <h4 className="text-sm font-semibold mb-3 pb-2 border-b">视频生成</h4>
              {(() => {
                if (!detailShotData) return null;
                const shotPrompts = promptsByShot.get(detailShotData.shotId) || [];
                const imagePrompts = shotPrompts.filter((p) => p.prompt_type === "image");
                const videoPrompts = shotPrompts.filter((p) => p.prompt_type === "video");

                if (imagePrompts.length === 0) {
                  return (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>🔒 等待图片生成</span>
                    </div>
                  );
                }

                if (videoPrompts.length === 0) {
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDetailShotId(null);
                        openPlatformDialog(detailShotData.shotId, "video");
                      }}
                    >
                      选择平台生成
                    </Button>
                  );
                }

                return videoPrompts.map((p) => {
                  const version = getCurrentVersion(p);
                  const hasMultipleVersions = (p.prompt_versions?.length || 0) > 1;
                  const sourceInfo = p.source_prompt_id
                    ? sourcePromptMap.get(p.source_prompt_id)
                    : null;

                  return (
                    <div key={p.id} className="bg-background border rounded p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary" className="text-xs">
                          {getPlatformName("video", p.platform)}
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
                            onClick={() => {
                              setDetailShotId(null);
                              openPlatformDialog(detailShotData.shotId, "video");
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
                      {/* 来源图片信息 */}
                      {sourceInfo && (
                        <p className="text-xs text-muted-foreground mb-2">
                          来源图片: {sourceInfo.platform} v{sourceInfo.version} →
                        </p>
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
    </div>
  );
}
