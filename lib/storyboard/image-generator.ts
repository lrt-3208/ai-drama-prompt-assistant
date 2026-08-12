// ============================================
// 故事板图片生成管线 — 截图 + 优化提示词
// 下载截图 → 构建提示词 → 截图存为 asset → 记录
// 不调用 AI 图片生成 API，用户手动上传优化后的图片
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Storyboards from "@/lib/models/storyboards";
import { buildOptimizationPrompt } from "./optimization-prompt";
import { createTosClient, getTOSBucket } from "@/lib/tos/client";
import { generateTosKey, extractImageDimensions, calculateHash } from "@/lib/tos/utils";
import { getPublicUrl } from "@/lib/tos/public-url";

/** DI 上下文 */
export interface ImageGeneratorContext {
  supabase?: SupabaseClient;
}

/**
 * 从 TOS 下载对象 → Buffer
 */
async function downloadFromTOS(tosKey: string): Promise<Buffer> {
  const tosClient = createTosClient();
  const bucket = getTOSBucket();

  const resp = await tosClient.getObjectV2({ bucket, key: tosKey, dataType: "buffer" });
  return resp.data.content as Buffer;
}

/**
 * 生成故事板粗稿图片 + 优化提示词
 *
 * 完整流程：
 * 1. 下载截图 from TOS → Buffer
 * 2. 查询 StoryboardDocument + 项目信息 + 风格预设
 * 3. 程序化构建优化提示词（零 AI 调用）
 * 4. 将截图上传到 TOS 永久路径（作为粗稿图片）
 * 5. 创建 assets 记录
 * 6. 软删除旧 storyboard_image asset
 * 7. 更新 storyboards 表
 * 8. 删除临时截图 from TOS
 *
 * 不调用 AI 图片生成 API。用户可拿着截图 + 优化提示词
 * 去外部工具生成优化图片，然后手动上传。
 *
 * @param sceneId 场景 ID
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param screenshotTosKey 截图已上传到 TOS 的 key
 * @param ctx DI 上下文
 * @returns { assetId, imageUrl, optimizationPrompt }
 */
export async function generateStoryboardImage(
  sceneId: string,
  projectId: string,
  userId: string,
  screenshotTosKey: string,
  ctx?: ImageGeneratorContext
): Promise<{ assetId: string; imageUrl: string; optimizationPrompt: string }> {
  const { createServiceClient } = await import("@/utils/supabase/service");
  const supabase = ctx?.supabase ?? createServiceClient();

  // 1. 下载截图 from TOS → Buffer
  const screenshotBuffer = await downloadFromTOS(screenshotTosKey);

  // 2. 查询 StoryboardDocument
  const storyboard = await Storyboards.getByScene(sceneId, { supabase });
  if (!storyboard || !storyboard.document) {
    throw new Error("Storyboard 文档不存在或未生成，请先生成 Storyboard 文档");
  }

  // 3. 查询场景信息 + 集信息
  const { data: scene } = await supabase
    .from("scenes")
    .select("scene_number, location_name, location_id, episode_id")
    .eq("id", sceneId)
    .maybeSingle();

  if (!scene) {
    throw new Error("场景不存在");
  }

  // 查询集信息
  let episodeTitle = "";
  if (scene.episode_id) {
    const { data: episode } = await supabase
      .from("episodes")
      .select("episode_number, title")
      .eq("id", scene.episode_id)
      .maybeSingle();
    if (episode) {
      episodeTitle = `第 ${episode.episode_number} 集${episode.title ? " · " + episode.title : ""}`;
    }
  }

  // 查询项目名称 + 风格预设
  const { data: project } = await supabase
    .from("projects")
    .select("name, style_preset_id")
    .eq("id", projectId)
    .maybeSingle();

  const projectName = project?.name || "";

  let stylePresetPrompt: string | null = null;
  if (project?.style_preset_id) {
    const { data: preset } = await supabase
      .from("style_presets")
      .select("fixed_prompt")
      .eq("id", project.style_preset_id)
      .maybeSingle();
    stylePresetPrompt = preset?.fixed_prompt || null;
  }

  // 查询该场景的镜头数量
  const { count: totalShots } = await supabase
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("scene_id", sceneId);

  // 4. 程序化构建优化提示词（零 AI 调用）
  const optimizationPrompt = buildOptimizationPrompt(storyboard.document, {
    projectName,
    episodeTitle,
    sceneNumber: scene.scene_number || 0,
    locationName: scene.location_name || "",
    totalShots: totalShots || storyboard.document.frames.length,
    stylePresetPrompt,
  });

  // 5. 将截图上传到 TOS 永久路径（作为粗稿图片）
  // html-to-image 截图始终为 PNG
  const mimeType = "image/png";
  const { width, height } = extractImageDimensions(screenshotBuffer);
  const hash = calculateHash(screenshotBuffer);

  const tosKey = generateTosKey(
    projectId,
    "storyboard_image",
    "storyboard",
    sceneId,
    mimeType
  );

  const tosClient = createTosClient();
  const bucket = getTOSBucket();
  await tosClient.putObject({
    bucket,
    key: tosKey,
    body: screenshotBuffer,
    contentType: mimeType,
  });

  // 6. 创建 assets 记录
  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .insert({
      user_id: userId,
      project_id: projectId,
      asset_type: "storyboard_image",
      source_type: "upload",
      entity_type: "storyboard",
      entity_id: sceneId,
      tos_key: tosKey,
      original_name: `storyboard_scene_${scene.scene_number || 0}_draft.png`,
      mime_type: mimeType,
      file_size: screenshotBuffer.length,
      width: width || null,
      height: height || null,
      hash,
      status: "active",
      sync_status: "synced",
    })
    .select("id")
    .single();

  if (assetError || !asset) {
    throw new Error(`创建 asset 记录失败: ${assetError?.message || "unknown"}`);
  }

  // 7. 软删除旧 storyboard_image asset（同 entity + 同 asset_type 的旧记录）
  await supabase
    .from("assets")
    .update({ status: "inactive" })
    .eq("project_id", projectId)
    .eq("entity_type", "storyboard")
    .eq("entity_id", sceneId)
    .eq("asset_type", "storyboard_image")
    .neq("id", asset.id);

  // 8. 更新 storyboards.storyboard_image_asset_id + optimized_image_prompt
  await Storyboards.updateImageAsset(
    storyboard.id,
    {
      assetId: asset.id,
      optimizationPrompt,
    },
    { supabase }
  );

  // 9. 删除临时截图 from TOS
  try {
    await tosClient.deleteObject({ bucket, key: screenshotTosKey });
  } catch (e) {
    console.warn("[image-generator] 删除临时截图失败:", e);
  }

  // 10. 返回结果
  const imageUrl = getPublicUrl(tosKey);

  return {
    assetId: asset.id,
    imageUrl,
    optimizationPrompt,
  };
}
