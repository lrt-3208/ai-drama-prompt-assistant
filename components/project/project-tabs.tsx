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
  { label: "Prompt", href: "/prompts", key: "prompts" },
  { label: "设置", href: "/settings", key: "settings" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const basePath = `/projects/${projectId}`;

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const href = tab.href ? `${basePath}${tab.href}` : basePath;
        const isActive = pathname === href;
        return (
          <Link
            key={tab.key}
            href={href}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
