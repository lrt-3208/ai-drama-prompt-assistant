-- ============================================
-- Migration v15: Phase 4 一致性系统
-- 1. character_visual_specs — 角色视觉规范（4 类轻量设计）
--
-- 注：storyboards.is_stale / prompts.is_stale 已在 migration_v13.sql 中创建
-- 注：project_tasks task_type='run_impact' 已在 migration_v13.sql 中添加
-- ============================================

-- ============================================
-- 1. character_visual_specs — 角色视觉规范
--    4 类：appearance / expression / costume / camera_reference
--    按需生成，不自动调用
-- ============================================
CREATE TABLE IF NOT EXISTS character_visual_specs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  spec_type     TEXT NOT NULL CHECK (spec_type IN ('appearance','expression','costume','camera_reference')),
  spec_name     TEXT NOT NULL,
  spec_prompt   TEXT NOT NULL,
  spec_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(character_id, spec_type)
);

CREATE INDEX IF NOT EXISTS idx_cvs_character ON character_visual_specs(character_id);
CREATE INDEX IF NOT EXISTS idx_cvs_project ON character_visual_specs(project_id);
CREATE INDEX IF NOT EXISTS idx_cvs_type ON character_visual_specs(spec_type);

SELECT create_updated_at_trigger('character_visual_specs');

ALTER TABLE character_visual_specs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_visual_specs_all_own" ON character_visual_specs;
CREATE POLICY "character_visual_specs_all_own" ON character_visual_specs
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));

COMMENT ON TABLE character_visual_specs IS '角色视觉规范：4 类轻量设计，按需 AI 生成';
COMMENT ON COLUMN character_visual_specs.spec_type IS '规范类型：appearance(外貌) / expression(表情) / costume(服装) / camera_reference(摄影参考)';
COMMENT ON COLUMN character_visual_specs.spec_prompt IS '规范 Prompt 文本';
COMMENT ON COLUMN character_visual_specs.spec_asset_id IS '关联图片资产 ID（可选）';
