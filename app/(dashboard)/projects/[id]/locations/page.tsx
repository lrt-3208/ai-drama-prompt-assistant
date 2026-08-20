import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { LocationList } from "@/components/project/location-list";
import { getPublicUrl } from "@/lib/tos/public-url";

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 3 个独立查询并行执行（含项目级锁定判定：已有剧情则资产锁定）
  const [locationsRes, activeTaskRes, plotCountRes] = await Promise.all([
    supabase
      .from("locations")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("project_tasks")
      .select("id, status, progress, task_type")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("episodes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .not("plot_outline", "is", null),
  ]);

  // 查询场景参考图的公共 URL
  const refIds = (locationsRes.data || [])
    .map((l) => l.reference_asset_id)
    .filter((id): id is string => !!id);
  const assetUrls: Record<string, string> = {};
  if (refIds.length > 0) {
    const { data: assets } = await supabase
      .from("assets")
      .select("id, tos_key")
      .in("id", refIds)
      .eq("status", "active")
      .eq("sync_status", "synced");
    for (const a of assets || []) {
      assetUrls[a.id] = getPublicUrl(a.tos_key);
    }
  }

  const plotCount = plotCountRes.count ?? 0;

  return (
    <LocationList
      projectId={id}
      initial={locationsRes.data ?? []}
      activeTask={activeTaskRes.data as never}
      assetUrls={assetUrls}
      assetLocked={plotCount > 0}
      plotCount={plotCount}
    />
  );
}
