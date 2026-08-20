"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Project {
  id: string;
  name: string;
  synopsis: string | null;
  genre: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** 相对时间：项目卡展示「更新于 X」比 workflow 状态更有参考价值 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ProjectList({ initialProjects }: { initialProjects: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此项目？删除后不可恢复。")) return;

    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error || "删除失败");
      return;
    }

    toast.success("已删除");
    setProjects(projects.filter((p) => p.id !== id));
  };

  // 创建项目跳转独立页面（对照原型 01-create.html 单开页面）
  const createButton = (
    <Button onClick={() => router.push("/projects/new")}>新建项目</Button>
  );

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">还没有项目，创建一个开始吧</p>
        {createButton}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">我的项目</h2>
        {createButton}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => {
          return (
            <div
              key={project.id}
              className="bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => router.push(`/projects/${project.id}`)}
            >
              <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-foreground truncate">{project.name}</span>
                <span className="text-[10px] text-muted-foreground/80 shrink-0 mt-0.5">
                  更新于 {relativeTime(project.updated_at)}
                </span>
              </div>
              <div className="p-4">
                {project.synopsis && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
                    {project.synopsis}
                  </p>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  {project.genre ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-muted-foreground border border-border">
                      {project.genre}
                    </span>
                  ) : (
                    <span />
                  )}
                  <button
                    className="text-[9px] text-destructive hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(project.id);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
