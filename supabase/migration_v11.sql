-- ============================================
-- Migration v11: 视觉资产系统
-- 1. 创建 assets 统一资源表（私有 TOS + tos_key + source_type + sync_status + deleted_at）
-- 2. characters ADD COLUMN（visual_description, portrait_prompt, portrait_asset_id）
-- 3. locations ADD COLUMN（visual_description, scene_prompt, reference_asset_id）
-- 4. prompts ADD COLUMN（reference_images, image_suggestions）
-- 注意：不创建 set_task_model_snapshot RPC（业务层 TypeScript 直接 update payload）
-- ============================================

-- ============================================
-- 1. assets — 统一视觉资源表
--    asset_type = 是什么东西（character_portrait / location_reference / ...）
--    source_type = 怎么来的（upload / ai_generated）
--    sync_status = TOS 同步状态（uploading / synced / failed）
--    status = 逻辑状态（active / inactive），删除用 deleted_at 事件时间戳
-- ============================================
CREATE TABLE IF NOT EXISTS assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_type    TEXT NOT NULL CHECK (asset_type IN (
                  'character_portrait',
                  'location_reference',
                  'prop_image',
                  'costume_image',
                  'style_reference',
                  'shot_image',
                  'shot_video'
                )),
  source_type   TEXT NOT NULL DEFAULT 'upload'
                CHECK (source_type IN ('upload', 'ai_generated')),
  entity_type   TEXT NOT NULL CHECK (entity_type IN (
                  'character', 'location', 'visual_style', 'shot', 'prompt'
                )),
  entity_id     UUID NOT NULL,
  tos_key       TEXT NOT NULL,
  original_name TEXT,
  mime_type     TEXT NOT NULL,
  file_size     BIGINT,
  width         INTEGER,
  height        INTEGER,
  hash          TEXT,
  metadata      JSONB DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive')),
  sync_status   TEXT NOT NULL DEFAULT 'synced'
                CHECK (sync_status IN ('uploading', 'synced', 'failed')),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_entity ON assets(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_assets_active
  ON assets(user_id, project_id, asset_type, source_type)
  WHERE status = 'active' AND deleted_at IS NULL;

-- updated_at trigger（显式 DROP + CREATE，不依赖 helper 函数）
DROP TRIGGER IF EXISTS assets_updated_at ON assets;
CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS — 通过 user_owns_project 保证用户只能操作自己项目的资源
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assets_all_own" ON assets;
CREATE POLICY "assets_all_own" ON assets FOR ALL
  USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));

-- ============================================
-- 2. characters — 增加视觉资产字段
--    portrait_asset_id 存 assets.id（非 URL）
--    保留旧列 reference_image_url 不动（零引用废列）
-- ============================================
ALTER TABLE characters ADD COLUMN IF NOT EXISTS visual_description TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS portrait_prompt TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS portrait_asset_id UUID;

COMMENT ON COLUMN characters.visual_description IS 'AI 生成的视觉化外貌描述（区别于用户输入的 appearance）';
COMMENT ON COLUMN characters.portrait_prompt IS '角色肖像图生成的专用 prompt';
COMMENT ON COLUMN characters.portrait_asset_id IS '关联 assets.id（角色定妆照/参考图）';

-- ============================================
-- 3. locations — 增加视觉资产字段
--    reference_asset_id 存 assets.id（非 URL）
-- ============================================
ALTER TABLE locations ADD COLUMN IF NOT EXISTS visual_description TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS scene_prompt TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS reference_asset_id UUID;

COMMENT ON COLUMN locations.visual_description IS 'AI 生成的视觉化场景描述';
COMMENT ON COLUMN locations.scene_prompt IS '场景参考图生成的专用 prompt';
COMMENT ON COLUMN locations.reference_asset_id IS '关联 assets.id（场景参考图）';

-- ============================================
-- 4. prompts — 增加参考图/建议图字段
-- ============================================
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS reference_images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS image_suggestions JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prompts.reference_images IS '该 prompt 关联的参考图 asset_id 数组';
COMMENT ON COLUMN prompts.image_suggestions IS 'AI 建议的参考图描述（不发送给文本模型）';
