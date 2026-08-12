"use client";

// ============================================
// 故事板文档视图 — 专业制片文档风格（白底、固定 1400px 宽）
// 显式颜色，不依赖应用主题（暗色模式下截图仍为白底文档）
// 截图即成品：html-to-image 2x 输出 = 最终交付图
// ============================================

import type { ReactNode } from "react";
import type { StoryboardRenderData } from "@/lib/storyboard/document-types";
import { FrameCard } from "./frame-card";
import { EmotionCurve } from "./emotion-curve";
import {
  Aperture,
  Camera,
  Clapperboard,
  Film,
  MapPin,
  Move,
  Music,
  Scissors,
  TrendingUp,
  Users,
  Volume2,
  Zap,
} from "lucide-react";

interface StoryboardDocumentViewProps {
  data: StoryboardRenderData;
}

/** 黑色表头中的元信息项 */
function HeaderMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="shrink-0 text-[11px] text-gray-400">{label}:</span>
      <span className="text-xs font-medium text-white">{value}</span>
    </div>
  );
}

/** 文档板块容器 — 浅灰底 + 标题栏 */
function Section({
  icon,
  title,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-gray-200 bg-gray-50 p-3 ${className ?? ""}`}>
      <h3 className="mb-2 flex items-center gap-1.5 border-b border-gray-200 pb-1.5 text-xs font-semibold text-gray-900">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** 底部板块中的「图标 + 标签: 内容」行 */
function MetaRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5 text-[11px] leading-relaxed">
      <span className="flex shrink-0 items-center gap-1 font-semibold text-gray-900">
        {icon}
        {label}:
      </span>
      <span className="text-gray-600">{children}</span>
    </div>
  );
}

export function StoryboardDocumentView({ data }: StoryboardDocumentViewProps) {
  const {
    document,
    characters,
    locationImageUrl,
    frameImages,
    projectName,
    episodeTitle,
    sceneNumber,
    locationName,
    totalShots,
  } = data;

  if (!document) {
    return <div className="py-12 text-center text-sm text-gray-400">暂无故事板文档数据</div>;
  }

  return (
    <div
      id="storyboard-document"
      className="w-[1400px] space-y-3 bg-white p-5 text-gray-900"
      style={{
        fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
      }}
    >
      {/* ===== 表头黑色条 ===== */}
      <header className="rounded-lg bg-gray-900 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
          <div className="flex items-center gap-2">
            <Clapperboard className="size-5 text-white" />
            <span className="text-base font-bold text-white">项目名称《{projectName}》</span>
            <span className="text-xs text-gray-400">{episodeTitle}</span>
          </div>
          <HeaderMeta label="总镜头数" value={`${totalShots} 个`} />
          <HeaderMeta label="整体色调方案" value={document.header.color_scheme} />
          <HeaderMeta label="统一氛围基调" value={document.header.mood_tone} />
          <HeaderMeta label="剪辑节奏风格" value={document.header.editing_rhythm} />
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          场景 {sceneNumber} · {locationName}
        </p>
      </header>

      {/* ===== 主体三列 ===== */}
      <div className="grid grid-cols-[200px_1fr_240px] gap-3">
        {/* 左列：角色参考 */}
        <Section icon={<Users className="size-3.5" />} title="角色与造型参考">
          {characters.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-gray-400">本场景无角色</p>
          ) : (
            <div className="space-y-3">
              {characters.map((c) => (
                <div key={c.name} className="space-y-1">
                  <div className="aspect-[3/4] overflow-hidden rounded-md border border-gray-200 bg-gray-100">
                    {c.portraitUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.portraitUrl} alt={c.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">
                        无图
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-gray-900">{c.name}</p>
                  {c.role && <p className="text-[10px] text-gray-500">{c.role}</p>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 中列：镜头帧区 */}
        <Section icon={<Film className="size-3.5" />} title={`故事板帧区（共 ${totalShots} 镜）`}>
          <div className="grid grid-cols-2 gap-2.5">
            {document.frames.map((frame) => (
              <FrameCard
                key={frame.shot_number}
                frame={frame}
                imageUrl={frameImages[frame.shot_number]}
              />
            ))}
          </div>
        </Section>

        {/* 右列：场景设计 */}
        <Section icon={<MapPin className="size-3.5" />} title="环境与场景设计">
          <div className="aspect-video overflow-hidden rounded-md border border-gray-200 bg-gray-100">
            {locationImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={locationImageUrl} alt={locationName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">
                无场景图
              </div>
            )}
          </div>
          {locationName && <p className="mt-1.5 text-[11px] text-gray-500">{locationName}</p>}
        </Section>
      </div>

      {/* ===== 底部三列 ===== */}
      <div className="grid grid-cols-3 gap-3">
        {/* 情绪曲线 */}
        <Section icon={<TrendingUp className="size-3.5" />} title="情绪关键词与情绪轴线">
          <EmotionCurve data={document.emotion_curve} />
        </Section>

        {/* 音频氛围 */}
        <Section icon={<Volume2 className="size-3.5" />} title="音频氛围">
          <div className="space-y-2">
            <MetaRow icon={<Volume2 className="size-3" />} label="环境声">
              {document.audio.environment_sound}
            </MetaRow>
            <MetaRow icon={<Music className="size-3" />} label="音乐">
              {document.audio.music}
            </MetaRow>
            <div className="flex gap-1.5 text-[11px] leading-relaxed">
              <span className="flex shrink-0 items-center gap-1 font-semibold text-gray-900">
                <Zap className="size-3" />
                关键音效:
              </span>
              <span className="flex flex-wrap gap-1">
                {document.audio.key_sound_effects.map((s, i) => (
                  <span
                    key={i}
                    className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-600"
                  >
                    {s}
                  </span>
                ))}
              </span>
            </div>
          </div>
        </Section>

        {/* 摄影笔记 */}
        <Section icon={<Camera className="size-3.5" />} title="电影摄影笔记">
          <div className="space-y-2">
            <MetaRow icon={<Aperture className="size-3" />} label="镜头特性">
              {document.cinematography_notes.lens_spec}
            </MetaRow>
            <MetaRow icon={<Move className="size-3" />} label="运镜风格">
              {document.cinematography_notes.movement_style}
            </MetaRow>
            <MetaRow icon={<Scissors className="size-3" />} label="转场偏好">
              {document.cinematography_notes.transition_pref}
            </MetaRow>
          </div>
        </Section>
      </div>
    </div>
  );
}
