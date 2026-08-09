-- ============================================
-- Migration v17: storyboard_versions — Storyboard 版本历史
--     镜像 prompt_versions 设计，支持版本切换
-- ============================================

CREATE TABLE IF NOT EXISTS storyboard_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storyboard_id   UUID NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assistant_prompt TEXT NOT NULL,
  image_refs      JSONB,
  version_number  INT NOT NULL,
  is_current      BOOLEAN NOT NULL DEFAULT false,
  source          TEXT NOT NULL DEFAULT 'ai',
  ai_model        TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sb_versions_storyboard_version
  ON storyboard_versions(storyboard_id, version_number);

CREATE INDEX IF NOT EXISTS idx_sb_versions_storyboard
  ON storyboard_versions(storyboard_id);

CREATE INDEX IF NOT EXISTS idx_sb_versions_project
  ON storyboard_versions(project_id);

ALTER TABLE storyboard_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "storyboard_versions_all_own" ON storyboard_versions;
CREATE POLICY "storyboard_versions_all_own" ON storyboard_versions
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));

COMMENT ON TABLE storyboard_versions IS 'Storyboard 版本历史：每次 AI 生成或手动编辑都保存版本';
COMMENT ON COLUMN storyboard_versions.assistant_prompt IS '该版本的提示词内容';
COMMENT ON COLUMN storyboard_versions.image_refs IS '该版本对应的图片引用快照';
COMMENT ON COLUMN storyboard_versions.is_current IS '是否为当前版本';
COMMENT ON COLUMN storyboard_versions.source IS '来源：ai / manual';

-- ============================================
-- 为现有 storyboards 的 assistant_prompt 创建初始版本
-- ============================================
INSERT INTO storyboard_versions (storyboard_id, project_id, assistant_prompt, image_refs, version_number, is_current, source)
SELECT id, project_id, assistant_prompt, image_refs, version_number, true, 'ai'
FROM storyboards
WHERE assistant_prompt IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================
-- 触发器：updated_at
-- ============================================
SELECT create_updated_at_trigger('storyboard_versions');
