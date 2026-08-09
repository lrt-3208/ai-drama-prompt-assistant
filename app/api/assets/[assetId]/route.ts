import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createTosClient, getTOSBucket } from "@/lib/tos/client";

/**
 * DELETE /api/assets/[assetId]
 *
 * 软删除 asset：status='inactive' + deleted_at=now()
 * TOS 对象异步删除（后台清理）
 *
 * 同时清除实体表的 asset 关联
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { assetId } = await params;

  // 查询 asset — RLS 自动校验
  const { data: asset, error: queryError } = await supabase
    .from("assets")
    .select("id, project_id, entity_type, entity_id, asset_type, tos_key, status")
    .eq("id", assetId)
    .maybeSingle();

  if (queryError || !asset) {
    return NextResponse.json(
      { error: "asset 不存在或无权访问" },
      { status: 404 }
    );
  }

  // 软删除 asset
  const { error: updateError } = await supabase
    .from("assets")
    .update({
      status: "inactive",
      deleted_at: new Date().toISOString(),
    })
    .eq("id", assetId);

  if (updateError) {
    return NextResponse.json(
      { error: "软删除失败", detail: updateError.message },
      { status: 500 }
    );
  }

  // 清除实体关联
  const columnMap: Record<string, string> = {
    "character_portrait": "portrait_asset_id",
    "location_reference": "reference_asset_id",
  };
  const tableMap: Record<string, string> = {
    character: "characters",
    location: "locations",
  };

  const column = columnMap[asset.asset_type];
  const table = tableMap[asset.entity_type];

  if (column && table) {
    // 只清除匹配的关联（避免清除指向其他 asset 的关联）
    await supabase
      .from(table)
      .update({ [column]: null })
      .eq("id", asset.entity_id)
      .eq(column, assetId);
  }

  // 异步删除 TOS 对象（失败不阻塞响应）
  try {
    const tosClient = createTosClient();
    const bucket = getTOSBucket();
    await tosClient.deleteObject({ bucket, key: asset.tos_key });
  } catch {
    // TOS 删除失败 — 记录日志，不影响响应
    // 后台清理任务会处理
  }

  return NextResponse.json({ success: true, assetId });
}
