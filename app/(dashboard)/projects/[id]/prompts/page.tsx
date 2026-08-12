import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { PromptWorkbench } from "@/components/project/prompt-workbench";
import { ImpactBanner } from "@/components/project/impact-banner";
import { getPublicUrl } from "@/lib/tos/public-url";

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 10 个独立查询并行执行，从串行 10×RTT 降到 1×RTT
  const [
    episodesRes,
    promptsRes,
    activePromptTasksRes,
    charactersRes,
    locationsRes,
    shotAssetsRes,
    storyboardsRes,
    storyboardVersionsRes,
    projectRes,
    stylePresetsRes,
  ] = await Promise.all([
    supabase
      .from("episodes")
      .select("id, episode_number, title, summary, scenes(id, scene_number, location_name, location_id, time, shots(id, shot_number, description, shot_characters(character_id)))")
      .eq("project_id", id)
      .order("episode_number")
      .order("scene_number", { referencedTable: "scenes", ascending: true })
      .order("shot_number", { referencedTable: "scenes.shots", ascending: true }),
    supabase
      .from("prompts")
      .select("id, shot_id, scene_id, prompt_type, platform, language, source_prompt_id, negative_prompt, quality_score, quality_note, is_stale, stale_reason, prompt_versions(id, content, version_number, is_current, source, ai_model, negative_prompt)")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .order("version_number", { referencedTable: "prompt_versions", ascending: false }),
    supabase
      .from("project_tasks")
      .select("id, status, payload, task_type")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .in("task_type", ["generate_prompt", "generate_scene_video_prompt", "generate_storyboard_asset", "generate_storyboard_image", "evaluate_prompt"])
      .order("created_at", { ascending: false }),
    supabase
      .from("characters")
      .select("id, name, portrait_asset_id")
      .eq("project_id", id),
    supabase
      .from("locations")
      .select("id, name, reference_asset_id")
      .eq("project_id", id),
    supabase
      .from("assets")
      .select("id, entity_id, tos_key")
      .eq("project_id", id)
      .eq("entity_type", "shot")
      .eq("asset_type", "shot_image")
      .eq("status", "active"),
    supabase
      .from("storyboards")
      .select("id, scene_id, status, version_number, is_stale, stale_reason, document, storyboard_image_asset_id, optimized_image_prompt")
      .eq("project_id", id),
    supabase
      .from("storyboard_versions")
      .select("id, storyboard_id, document, version_number, is_current, source, ai_model")
      .eq("project_id", id)
      .order("version_number", { ascending: false }),
    supabase
      .from("projects")
      .select("style_preset_id, name")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("style_presets")
      .select("id, name, category, fixed_prompt")
      .order("sort_order", { ascending: true }),
  ]);

  // 从并行结果中提取 data
  const episodes = episodesRes.data;
  const prompts = promptsRes.data;
  const activePromptTasks = activePromptTasksRes.data;
  const characters = charactersRes.data;
  const locations = locationsRes.data;
  const shotAssets = shotAssetsRes.data;
  const storyboards = storyboardsRes.data;
  const storyboardVersions = storyboardVersionsRes.data;
  const project = projectRes.data;
  const stylePresets = stylePresetsRes.data;

  // 查询所有相关资产的 tos_key（角色定妆照 + 场景参考图 + 故事板优化图片）
  const portraitAndRefIds = [
    ...(characters || []).map((c) => c.portrait_asset_id),
    ...(locations || []).map((l) => l.reference_asset_id),
    ...(storyboards || []).map((sb) => sb.storyboard_image_asset_id),
  ].filter((id): id is string => !!id);

  const assetUrls: Record<string, string> = {};
  if (portraitAndRefIds.length > 0) {
    const { data: refAssets } = await supabase
      .from("assets")
      .select("id, tos_key")
      .in("id", portraitAndRefIds)
      .eq("status", "active")
      .eq("sync_status", "synced");
    for (const a of refAssets || []) {
      assetUrls[a.id] = getPublicUrl(a.tos_key);
    }
  }
  // shotAssets 已包含 tos_key，直接构造 URL
  for (const a of shotAssets || []) {
    assetUrls[a.id] = getPublicUrl(a.tos_key);
  }

  // 计算 stale 数量（用于 ImpactBanner）
  const stalePromptCount = (prompts || []).filter((p) => p.is_stale).length;
  const staleStoryboardCount = (storyboards || []).filter((sb) => sb.is_stale).length;

  // 构建详细 stale 列表（用于 RegenConfirm 确认弹窗）
  const staleItems: Array<{ id: string; label: string; reason: string; level: "shot" | "scene" }> = [];
  for (const p of prompts || []) {
    if (!p.is_stale) continue;
    if (p.shot_id) {
      // 查找镜头号
      let shotNum: number | null = null;
      outer: for (const ep of episodes || []) {
        for (const sc of ep.scenes || []) {
          for (const sh of sc.shots || []) {
            if (sh.id === p.shot_id) { shotNum = sh.shot_number; break outer; }
          }
        }
      }
      staleItems.push({ id: p.id, label: `镜头${shotNum ?? "?"} Image Prompt`, reason: p.stale_reason || "资产已修改", level: "shot" });
    }
    if (p.scene_id) {
      staleItems.push({ id: p.id, label: "场景视频 Prompt", reason: p.stale_reason || "资产已修改", level: "scene" });
    }
  }
  for (const sb of storyboards || []) {
    if (!sb.is_stale) continue;
    staleItems.push({ id: sb.scene_id, label: "Storyboard", reason: sb.stale_reason || "资产已修改", level: "scene" });
  }

  return (
    <div>
      <ImpactBanner
        projectId={id}
        stalePromptCount={stalePromptCount}
        staleStoryboardCount={staleStoryboardCount}
        staleItems={staleItems}
      />
      <PromptWorkbench
        projectId={id}
        projectName={project?.name || ""}
        episodes={episodes as never}
        prompts={prompts as never}
        activePromptTasks={(activePromptTasks || []) as never}
        characters={(characters || []) as never}
        locations={(locations || []) as never}
        shotAssets={(shotAssets || []) as never}
        storyboards={(storyboards || []) as never}
        storyboardVersions={(storyboardVersions || []) as never}
        stylePresetId={project?.style_preset_id ?? null}
        stylePresets={(stylePresets || []) as never}
        assetUrls={assetUrls}
      />
    </div>
  );
}
