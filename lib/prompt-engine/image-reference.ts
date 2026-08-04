// ============================================
// 图片资产抽象层
// MVP 阶段始终返回 null，不侵入数据库
// V2 接入实际图片生成后，此函数返回图片描述
// ============================================

/**
 * 获取镜头的图片资产参考（MVP 阶段始终返回 null）
 *
 * MVP：不侵入数据库，不创建 image_url 字段
 * V2：接入实际图片生成后，此函数返回图片描述
 *
 * @param _shotId 镜头 ID（MVP 未使用）
 * @returns 图片资产描述，MVP 返回 null
 */
export async function getShotImageReference(
  _shotId: string
): Promise<string | null> {
  // MVP：始终返回 null
  // V2 实现：
  // const cookieStore = await cookies();
  // const supabase = createClient(cookieStore);
  // const { data: shot } = await supabase
  //   .from("shots")
  //   .select("image_url, image_description")
  //   .eq("id", shotId)
  //   .single();
  // return shot?.image_description || null;
  return null;
}
