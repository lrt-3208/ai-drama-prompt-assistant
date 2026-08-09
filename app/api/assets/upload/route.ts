import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createTosClient, getTOSBucket } from "@/lib/tos/client";
import {
  generateTosKey,
  isValidImageType,
  isValidFileSize,
  extractImageDimensions,
  calculateHash,
} from "@/lib/tos/utils";
import { getPublicUrl } from "@/lib/tos/public-url";

export const maxDuration = 60;

/**
 * POST /api/assets/upload
 *
 * 上传图片到 TOS + 创建 assets 记录
 *
 * FormData:
 *   file: File（图片，支持 png/jpeg/webp，< 10MB）
 *   projectId: string
 *   entityType: 'character' | 'location' | 'visual_style' | 'shot' | 'prompt'
 *   entityId: string
 *   assetType: 'character_portrait' | 'location_reference' | ...
 *
 * sync_status 状态机:
 *   uploading → synced (TOS 成功)
 *   uploading → failed (TOS 失败，保留记录供审计/重试)
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 1. 解析 FormData
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "无效的 FormData" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const projectId = formData.get("projectId") as string | null;
  const entityType = formData.get("entityType") as string | null;
  const entityId = formData.get("entityId") as string | null;
  const assetType = formData.get("assetType") as string | null;

  if (!file || !projectId || !entityType || !entityId || !assetType) {
    return NextResponse.json(
      { error: "缺少必要参数: file, projectId, entityType, entityId, assetType" },
      { status: 400 }
    );
  }

  // 2. 校验文件类型
  if (!isValidImageType(file.type)) {
    return NextResponse.json(
      { error: `不支持的文件类型: ${file.type}，仅支持 png/jpeg/webp` },
      { status: 400 }
    );
  }

  // 3. 校验文件大小
  if (!isValidFileSize(file.size)) {
    return NextResponse.json(
      { error: "文件大小超过 10MB 限制" },
      { status: 400 }
    );
  }

  // 4. 提取图片元数据
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const { width, height } = extractImageDimensions(buffer);
  const hash = calculateHash(buffer);
  const originalName = file.name || "unnamed";

  // 5. 生成 TOS key
  const tosKey = generateTosKey(
    projectId,
    assetType,
    entityType,
    entityId,
    file.type
  );

  // 6. INSERT assets（sync_status='uploading'）
  //    RLS 自动校验 user_owns_project(project_id)
  const { data: asset, error: insertError } = await supabase
    .from("assets")
    .insert({
      user_id: user.id,
      project_id: projectId,
      asset_type: assetType,
      source_type: "upload",
      entity_type: entityType,
      entity_id: entityId,
      tos_key: tosKey,
      original_name: originalName,
      mime_type: file.type,
      file_size: file.size,
      width: width || null,
      height: height || null,
      hash,
      status: "active",
      sync_status: "uploading",
    })
    .select("id")
    .single();

  if (insertError || !asset) {
    return NextResponse.json(
      { error: "创建 asset 记录失败", detail: insertError?.message },
      { status: 500 }
    );
  }

  // 7. 上传 TOS
  try {
    const tosClient = createTosClient();
    const bucket = getTOSBucket();

    await tosClient.putObject({
      bucket,
      key: tosKey,
      body: buffer,
      contentType: file.type,
    });
  } catch (tosError) {
    // TOS 上传失败 → 标记 sync_status='failed'
    await supabase
      .from("assets")
      .update({ sync_status: "failed" })
      .eq("id", asset.id);

    return NextResponse.json(
      {
        error: "TOS 上传失败",
        detail: tosError instanceof Error ? tosError.message : "unknown",
        assetId: asset.id,
      },
      { status: 500 }
    );
  }

  // 8. TOS 成功 → 标记 sync_status='synced'
  await supabase
    .from("assets")
    .update({ sync_status: "synced" })
    .eq("id", asset.id);

  // 9. 软删除旧 asset（同 entity + 同 asset_type 的旧记录）
  await supabase
    .from("assets")
    .update({ status: "inactive" })
    .eq("project_id", projectId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("asset_type", assetType)
    .neq("id", asset.id);

  // 10. 更新实体关联字段
  const entityUpdateResult = await updateEntityAssetRef(
    supabase,
    entityType,
    entityId,
    assetType,
    asset.id
  );

  if (!entityUpdateResult.ok) {
    // entity 更新失败 — asset 已 synced，进入 repair 流程
    return NextResponse.json(
      {
        error: "asset 已上传但实体关联失败",
        detail: entityUpdateResult.error,
        assetId: asset.id,
        tosKey,
      },
      { status: 500 }
    );
  }

  // 11. 返回（含公共 URL，前端直接用）
  return NextResponse.json({
    assetId: asset.id,
    tosKey,
    url: getPublicUrl(tosKey),
    syncStatus: "synced",
    width,
    height,
  });
}

/**
 * 更新实体表的 asset 关联字段
 * character_portrait → characters.portrait_asset_id
 * location_reference → locations.reference_asset_id
 */
async function updateEntityAssetRef(
  supabase: ReturnType<typeof createClient>,
  entityType: string,
  entityId: string,
  assetType: string,
  assetId: string
): Promise<{ ok: boolean; error?: string }> {
  const columnMap: Record<string, string> = {
    "character_portrait": "portrait_asset_id",
    "location_reference": "reference_asset_id",
  };

  const tableMap: Record<string, string> = {
    character: "characters",
    location: "locations",
  };

  const column = columnMap[assetType];
  const table = tableMap[entityType];

  if (!column || !table) {
    // 暂不支持直接关联的实体/类型组合，asset 已创建但不更新实体表
    return { ok: true };
  }

  const { error } = await supabase
    .from(table)
    .update({ [column]: assetId })
    .eq("id", entityId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
