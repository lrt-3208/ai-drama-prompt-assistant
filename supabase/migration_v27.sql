-- ============================================
-- Migration v27: 成片回传字段 + 移除 shot_video 死枚举
--
-- 1. scenes 表新增 5 个 video 字段：成片外部链接回传 + video_snapshot 失效判定
-- 2. assets 表 asset_type CHECK 移除 'shot_video'（全代码零引用，死枚举）
--
-- 设计决策（2026-08 用户确认）：
-- - 成片只存外部 URL，不落文件到 TOS
-- - video_snapshot 复用 dependency_snapshot 机制，记录出片时三层依赖版本号
-- - 任一依赖变化（Prompt 重生/Storyboard 重跑/shot_image 更换）→ 对比 snapshot 判定成片失效
-- ============================================

-- ============================================
-- 1. scenes 表新增成片回传字段
-- ============================================

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS video_url         TEXT;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS video_provider    TEXT;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS video_duration    INTEGER;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS video_created_at TIMESTAMPTZ;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS video_snapshot    JSONB;

COMMENT ON COLUMN scenes.video_url         IS '成片外部链接（Kling/即梦/Runway 等平台产出，只存 URL 不落 TOS）';
COMMENT ON COLUMN scenes.video_provider    IS '视频来源平台（kling / jimeng / runway / other）';
COMMENT ON COLUMN scenes.video_duration    IS '视频时长（秒）';
COMMENT ON COLUMN scenes.video_created_at  IS '成片回传时间戳';
COMMENT ON COLUMN scenes.video_snapshot     IS '出片依赖快照：记录成片时的 scene_video_prompt / storyboard / shot_images 版本号，对比判定成片是否失效';

-- ============================================
-- 2. assets 表移除 shot_video 死枚举
--    全代码零引用（grep 确认仅 v11 原始定义 + v26 重建保留），属死枚举
-- ============================================

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_type_check CHECK (asset_type IN (
  'character_portrait',
  'location_reference',
  'prop_image',
  'costume_image',
  'style_reference',
  'shot_image',
  'storyboard_image'
));
