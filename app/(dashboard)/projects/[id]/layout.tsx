import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { ProjectTabs } from "@/components/project/project-tabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 使用 getUser() 远程验证用户身份（Supabase 安全推荐）
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, synopsis, genre, status")
    .eq("id", id)
    .neq("status", "deleted")
    .single();

  if (error || !project) {
    redirect("/dashboard");
  }

  // Tab 栏角标数据（对照原型 03/04/05 的 🔒 与数量 badge）：
  //   资产锁定 = 任一集已生成剧情大纲；常显数量 = 已生成分镜集数 / 已生成 Image Prompt 镜头数；
  //   过期数 = storyboards.is_stale 聚合（红色优先于常显数量展示）
  const [plotEpsRes, sbsRes, imgPromptsRes] = await Promise.all([
    supabase
      .from("episodes")
      .select("id")
      .eq("project_id", id)
      .not("plot_outline", "is", null)
      .limit(1),
    supabase
      .from("storyboards")
      .select("is_stale, scenes(episode_id)")
      .eq("project_id", id),
    supabase
      .from("prompts")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .eq("prompt_type", "image"),
  ]);
  const assetsLocked = (plotEpsRes.data?.length ?? 0) > 0;
  // scenes 为多对一嵌入：运行时可能是对象（实际形态）或数组（类型推断形态），两者兼容
  const episodeIdOf = (r: { scenes: unknown }) => {
    const s = r.scenes as
      | { episode_id?: string }
      | { episode_id?: string }[]
      | null;
    const ids = Array.isArray(s) ? s.map((x) => x.episode_id) : s ? [s.episode_id] : [];
    return (ids.filter((v): v is string => !!v))[0];
  };
  const allRows = sbsRes.data ?? [];
  const staleRows = allRows.filter((r) => r.is_stale);
  const generatedEpisodes = new Set(
    allRows.map(episodeIdOf).filter((v): v is string => !!v)
  ).size;
  const staleEpisodes = new Set(
    staleRows.map(episodeIdOf).filter((v): v is string => !!v)
  ).size;
  const staleScenes = staleRows.length;
  const imagePrompts = imgPromptsRes.count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{project.name}</h1>
          {project.synopsis && (
            <p className="text-sm text-muted-foreground">{project.synopsis}</p>
          )}
        </div>
        {project.genre && (
          <span className="text-sm text-muted-foreground px-3 py-1 rounded-full bg-muted">
            {project.genre}
          </span>
        )}
      </div>
      <ProjectTabs
        projectId={project.id}
        assetsLocked={assetsLocked}
        generatedEpisodes={generatedEpisodes}
        imagePrompts={imagePrompts}
        staleEpisodes={staleEpisodes}
        staleScenes={staleScenes}
      />
      <div className="mt-2">{children}</div>
    </div>
  );
}
