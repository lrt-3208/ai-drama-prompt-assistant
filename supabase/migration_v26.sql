-- ============================================
-- Migration v26: assets 表 CHECK 约束扩展
-- 新增 asset_type='storyboard_image'、entity_type='storyboard'
-- 支持故事板粗稿图片（截图）存储为 asset
-- ============================================

-- 1. 扩展 asset_type CHECK 约束：新增 'storyboard_image'
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_type_check CHECK (asset_type IN (
  'character_portrait',
  'location_reference',
  'prop_image',
  'costume_image',
  'style_reference',
  'shot_image',
  'shot_video',
  'storyboard_image'
));

-- 2. 扩展 entity_type CHECK 约束：新增 'storyboard'
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_entity_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_entity_type_check CHECK (entity_type IN (
  'character',
  'location',
  'visual_style',
  'shot',
  'prompt',
  'storyboard'
));
