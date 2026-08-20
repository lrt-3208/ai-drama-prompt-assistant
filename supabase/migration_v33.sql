-- ============================================
-- Migration v33: 故事板优化图片上传回传
--
-- 背景：image-generator 产出的粗稿图 + 优化提示词供用户在
-- Midjourney / Seedream 等外部工具生成优化版整页分镜图，
-- 但一直缺少「上传优化图」的存储入口（流程断点）。
--
-- 1. assets 表 asset_type CHECK 新增 'storyboard_image_optimized'
-- 2. storyboards 表新增 optimized_image_asset_id 指针字段
-- 3. 修正 storyboard_image_asset_id 注释（v24 注释写"优化后"，
--    实际存的是粗稿截图，语义对齐现状）
-- ============================================

-- 1. 扩展 asset_type CHECK 约束
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_type_check CHECK (asset_type IN (
  'character_portrait',
  'location_reference',
  'prop_image',
  'costume_image',
  'style_reference',
  'shot_image',
  'storyboard_image',
  'storyboard_image_optimized'
));

-- 2. storyboards 表新增优化图指针
ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS optimized_image_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;

-- 3. 注释修正
COMMENT ON COLUMN storyboards.storyboard_image_asset_id IS '粗稿图片（整页文档截图）asset ID，导出 PNG 时写入';
COMMENT ON COLUMN storyboards.optimized_image_asset_id IS '优化后的故事板图片 asset ID（用户在外部工具生成后上传回传）';
