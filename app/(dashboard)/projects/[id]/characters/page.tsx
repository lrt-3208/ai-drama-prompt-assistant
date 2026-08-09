import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { CharacterList } from "@/components/project/character-list";
import { getPublicUrl } from "@/lib/tos/public-url";

export default async function CharactersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 2 个独立查询并行执行
  const [charactersRes, activeTaskRes] = await Promise.all([
    supabase
      .from("characters")
      .select("*")
      .eq("project_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("project_tasks")
      .select("id, status, progress, task_type")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // 查询角色 fixed_prompt 当前版本号
  const versionMap: Record<string, number> = {};
  if ((charactersRes.data || []).length > 0) {
    const { data: charVersions } = await supabase
      .from("asset_prompt_versions")
      .select("entity_id, version_number")
      .eq("project_id", id)
      .eq("entity_type", "character")
      .eq("is_current", true);
    for (const v of charVersions || []) {
      versionMap[v.entity_id] = v.version_number;
    }
  }

  // 查询角色定妆照的公共 URL
  const portraitIds = (charactersRes.data || [])
    .map((c) => c.portrait_asset_id)
    .filter((id): id is string => !!id);
  const assetUrls: Record<string, string> = {};
  if (portraitIds.length > 0) {
    const { data: assets } = await supabase
      .from("assets")
      .select("id, tos_key")
      .in("id", portraitIds)
      .eq("status", "active")
      .eq("sync_status", "synced");
    for (const a of assets || []) {
      assetUrls[a.id] = getPublicUrl(a.tos_key);
    }
  }

  return (
    <div className="max-w-4xl">
      <CharacterList projectId={id} initial={charactersRes.data ?? []} activeTask={activeTaskRes.data as never} assetUrls={assetUrls} versionMap={versionMap} />
    </div>
  );
}
