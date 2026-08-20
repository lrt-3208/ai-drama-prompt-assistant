"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "故事", href: "/story", key: "story" },
  { label: "角色", href: "/characters", key: "characters" },
  { label: "场景", href: "/locations", key: "locations" },
  { label: "风格", href: "/style", key: "style" },
  { label: "剧本", href: "/script", key: "script" },
  { label: "分镜", href: "/storyboard", key: "storyboard" },
  { label: "画面指令", href: "/prompts", key: "prompts" },
  { label: "设置", href: "/settings", key: "settings" },
];

/** 已生成剧情后资产锁定的 Tab（对照原型 03/04/05 的 🔒） */
const LOCKED_TABS = new Set(["characters", "locations", "style"]);

export interface ProjectTabsProps {
  projectId: string;
  /** 任一集已生成剧情大纲 → 角色/场景/风格已锁定 */
  assetsLocked?: boolean;
  /** 已生成分镜内容的集数（常显数量 badge） */
  generatedEpisodes?: number;
  /** 已生成 Image Prompt 的镜头数（常显数量 badge） */
  imagePrompts?: number;
  /** 过期分镜的集数（storyboards.is_stale 按集聚合，红色优先展示） */
  staleEpisodes?: number;
  /** 过期场景数（画面指令需重跑，红色优先展示） */
  staleScenes?: number;
}

export function ProjectTabs({
  projectId,
  assetsLocked = false,
  generatedEpisodes = 0,
  imagePrompts = 0,
  staleEpisodes = 0,
  staleScenes = 0,
}: ProjectTabsProps) {
  const pathname = usePathname();
  const basePath = `/projects/${projectId}`;

  return (
    <nav className="flex gap-1 border-b border-border bg-card/60 backdrop-blur sticky top-0 z-30">
      {tabs.map((tab) => {
        const href = tab.href ? `${basePath}${tab.href}` : basePath;
        const isActive = pathname === href;
        const locked = assetsLocked && LOCKED_TABS.has(tab.key);
        const staleCount =
          tab.key === "storyboard" ? staleEpisodes : staleScenes;
        const totalCount =
          tab.key === "storyboard" ? generatedEpisodes : imagePrompts;
        return (
          <Link
            key={tab.key}
            href={href}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {locked && (
              <span
                className="text-[10px] opacity-70"
                title="已生成剧情，资产已锁定"
              >
                🔒
              </span>
            )}
            {(tab.key === "storyboard" || tab.key === "prompts") &&
              staleCount > 0 && (
              <span
                title={
                  tab.key === "storyboard"
                    ? `${staleCount} 集分镜已过期，需重新生成`
                    : `${staleCount} 个场景的指令已过期，需重跑`
                }
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-stale/20 text-stale"
              >
                {staleCount}
              </span>
            )}
            {(tab.key === "storyboard" || tab.key === "prompts") &&
              staleCount === 0 && totalCount > 0 && (
              <span
                title={
                  tab.key === "storyboard"
                    ? `已生成 ${totalCount} 集分镜内容`
                    : `已生成 ${totalCount} 个镜头的图片指令`
                }
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface2 text-muted-foreground border border-border"
              >
                {totalCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
