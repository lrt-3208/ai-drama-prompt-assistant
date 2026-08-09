-- ============================================
-- Migration v13: Phase 1 数据基座 + Storyboard 表
-- 1. 新建 shot_characters（替代 shots.character_ids JSONB）
-- 2. 新建 asset_prompt_versions（fixed_prompt 版本链）
-- 3. 新建 script_versions（剧本版本链）
-- 4. 新建 storyboards（场景视觉故事板资产）
-- 5. 数据迁移：shots.character_ids → shot_characters
-- 6. 删除 shots.character_ids 列
-- 7. prompts 扩展：scene_id + 三选一 CHECK + 新字段 + prompt_type CHECK 改为 scene_video
-- 8. prompt_templates 扩展：variables + negative_prompt_rule + template_version + prompt_type CHECK 加 scene_video
-- 9. scripts 扩展：current_version_id
-- 10. project_tasks task_type CHECK 扩展（generate_storyboard_asset / generate_scene_video_prompt / run_impact）
-- 11. RLS 更新：prompts + prompt_versions 新增 scene_id 分支 + 4 张新表
-- ============================================

-- ============================================
-- 1. shot_characters — 镜头角色关联表（替代 JSONB）
-- ============================================
CREATE TABLE IF NOT EXISTS shot_characters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shot_id      UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role_in_shot TEXT,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shot_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_sc_shot ON shot_characters(shot_id);
CREATE INDEX IF NOT EXISTS idx_sc_character ON shot_characters(character_id);

SELECT create_updated_at_trigger('shot_characters');

ALTER TABLE shot_characters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shot_characters_all_own" ON shot_characters;
CREATE POLICY "shot_characters_all_own" ON shot_characters
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM shots sh
      JOIN scenes s ON sh.scene_id = s.id
      JOIN episodes e ON s.episode_id = e.id
      WHERE sh.id = shot_characters.shot_id AND user_owns_project(e.project_id)
    )
  );

-- ============================================
-- 2. asset_prompt_versions — fixed_prompt 版本链
--    entity_type: character / location / visual_style
--    field_name: fixed_prompt / appearance / clothing 等
-- ============================================
CREATE TABLE IF NOT EXISTS asset_prompt_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('character','location','visual_style')),
  entity_id     UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  field_name    TEXT NOT NULL DEFAULT 'fixed_prompt',
  content       TEXT NOT NULL,
  version_number INT NOT NULL,
  is_current    BOOLEAN DEFAULT false,
  source        TEXT DEFAULT 'ai' CHECK (source IN ('ai','manual')),
  ai_model      TEXT,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_type, entity_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_apv_entity ON asset_prompt_versions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_apv_current ON asset_prompt_versions(entity_type, entity_id) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_apv_project ON asset_prompt_versions(project_id);

SELECT create_updated_at_trigger('asset_prompt_versions');

ALTER TABLE asset_prompt_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_prompt_versions_all_own" ON asset_prompt_versions;
CREATE POLICY "asset_prompt_versions_all_own" ON asset_prompt_versions
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));

-- ============================================
-- 3. script_versions — 剧本版本链
-- ============================================
CREATE TABLE IF NOT EXISTS script_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content       JSONB NOT NULL,
  version_number INT NOT NULL,
  is_current    BOOLEAN DEFAULT false,
  source        TEXT DEFAULT 'ai' CHECK (source IN ('ai','manual')),
  ai_model      TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_script_versions_project ON script_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_script_versions_current ON script_versions(project_id) WHERE is_current = true;

SELECT create_updated_at_trigger('script_versions');

ALTER TABLE script_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "script_versions_all_own" ON script_versions;
CREATE POLICY "script_versions_all_own" ON script_versions
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));

-- ============================================
-- 4. storyboards — 场景视觉故事板资产
--    Scene 级组合资产，包含该场景所有 Shot 图片编排 + assistant_prompt
--    不存储 video_prompt（Scene Video Prompt 唯一权威在 prompts 表）
-- ============================================
CREATE TABLE IF NOT EXISTS storyboards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id         UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status           TEXT DEFAULT 'draft' CHECK (status IN ('draft','ready','generated','failed')),
  storyboard_image TEXT,
  assistant_prompt TEXT,
  image_refs       JSONB DEFAULT '[]'::jsonb,
  is_stale         BOOLEAN DEFAULT false,
  stale_reason     TEXT,
  version_number   INT DEFAULT 1,
  sort_order       INT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scene_id)
);

CREATE INDEX IF NOT EXISTS idx_storyboards_scene ON storyboards(scene_id);
CREATE INDEX IF NOT EXISTS idx_storyboards_project ON storyboards(project_id);
CREATE INDEX IF NOT EXISTS idx_storyboards_status ON storyboards(project_id, status);

SELECT create_updated_at_trigger('storyboards');

ALTER TABLE storyboards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "storyboards_all_own" ON storyboards;
CREATE POLICY "storyboards_all_own" ON storyboards
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));

-- ============================================
-- 5. 数据迁移：shots.character_ids → shot_characters
--    将 JSONB 数组中的 character_id 逐条插入 shot_characters
-- ============================================
DO $$
DECLARE
  rec RECORD;
  char_ids TEXT[];
  idx INT;
BEGIN
  FOR rec IN SELECT id, character_ids FROM shots WHERE character_ids IS NOT NULL AND character_ids != '[]'::jsonb LOOP
    char_ids := ARRAY(SELECT jsonb_array_elements_text(rec.character_ids::jsonb));
    FOR idx IN 1..array_length(char_ids, 1) LOOP
      INSERT INTO shot_characters (shot_id, character_id, sort_order)
      VALUES (rec.id, char_ids[idx]::uuid, idx - 1)
      ON CONFLICT (shot_id, character_id) DO NOTHING;
    END LOOP;
  END LOOP;
END$$;

-- ============================================
-- 6. 删除 shots.character_ids 列
-- ============================================
ALTER TABLE shots DROP COLUMN IF EXISTS character_ids;

-- ============================================
-- 7. prompts 扩展
--    7a. 新增 scene_id 列
--    7b. 修改 CHECK 约束为三选一（shot_id / episode_id / scene_id）
--    7c. 修改 prompt_type CHECK（删除 video，新增 scene_video）
--    7d. 新增字段：negative_prompt / quality_score / quality_note / is_stale / stale_reason / dependency_snapshot
-- ============================================

-- 7a. 新增 scene_id
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS scene_id UUID REFERENCES scenes(id) ON DELETE CASCADE;

-- 7b. 修改三选一 CHECK 约束
ALTER TABLE prompts DROP CONSTRAINT IF EXISTS prompts_check;
ALTER TABLE prompts ADD CONSTRAINT prompts_check CHECK (
  (shot_id IS NOT NULL AND episode_id IS NULL AND scene_id IS NULL) OR
  (shot_id IS NULL AND episode_id IS NOT NULL AND scene_id IS NULL) OR
  (shot_id IS NULL AND episode_id IS NULL AND scene_id IS NOT NULL)
);

-- 7c. 修改 prompt_type CHECK（删除 'video'，新增 'scene_video'）
--     先清理旧的镜头级视频 Prompt 数据（Phase 0 已废弃镜头级视频链路）
DELETE FROM prompt_versions WHERE prompt_id IN (
  SELECT id FROM prompts WHERE prompt_type = 'video'
);
DELETE FROM prompts WHERE prompt_type = 'video';

ALTER TABLE prompts DROP CONSTRAINT IF EXISTS prompts_prompt_type_check;
ALTER TABLE prompts ADD CONSTRAINT prompts_prompt_type_check
  CHECK (prompt_type IN ('image','scene_video','voice','edit'));

-- 7d. 新增字段
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS negative_prompt TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_score INT CHECK (quality_score IS NULL OR (quality_score >= 1 AND quality_score <= 5));
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_note TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS is_stale BOOLEAN DEFAULT false;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS stale_reason TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS dependency_snapshot JSONB;

-- 新增索引
CREATE INDEX IF NOT EXISTS idx_prompts_scene_id ON prompts(scene_id);

COMMENT ON COLUMN prompts.scene_id IS '场景级 Prompt 关联（场景视频 Prompt 使用）';
COMMENT ON COLUMN prompts.negative_prompt IS 'Negative Prompt 负面提示词';
COMMENT ON COLUMN prompts.quality_score IS 'AI 质量评分 1-5';
COMMENT ON COLUMN prompts.is_stale IS '资产修改后标记过期，需重新生成';
COMMENT ON COLUMN prompts.dependency_snapshot IS '依赖快照：记录引用的角色/场景/风格/Shot Prompt/Storyboard 的版本号';

-- ============================================
-- 8. prompt_templates 扩展
--    8a. prompt_type CHECK 加 scene_video
--    8b. 新增 variables / negative_prompt_rule / template_version
-- ============================================

-- 8a. prompt_type CHECK 扩展
ALTER TABLE prompt_templates DROP CONSTRAINT IF EXISTS prompt_templates_prompt_type_check;
ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_prompt_type_check
  CHECK (prompt_type IN ('image','video','voice','edit','scene_video'));

-- 8b. 新增字段
ALTER TABLE prompt_templates ADD COLUMN IF NOT EXISTS variables JSONB DEFAULT '[]'::jsonb;
ALTER TABLE prompt_templates ADD COLUMN IF NOT EXISTS negative_prompt_rule TEXT;
ALTER TABLE prompt_templates ADD COLUMN IF NOT EXISTS template_version INT DEFAULT 1;

COMMENT ON COLUMN prompt_templates.variables IS '变量定义数组：[{name, description, required}]';
COMMENT ON COLUMN prompt_templates.negative_prompt_rule IS 'Negative Prompt 生成规则';
COMMENT ON COLUMN prompt_templates.template_version IS '模板版本号，用于版本追踪';

-- ============================================
-- 9. scripts 扩展：current_version_id
-- ============================================
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS current_version_id UUID;

COMMENT ON COLUMN scripts.current_version_id IS '指向 script_versions 当前版本';

-- ============================================
-- 10. project_tasks task_type CHECK 扩展
--     新增：generate_storyboard_asset / generate_scene_video_prompt / run_impact
--     删除：generate_video（镜头级已废弃）
--     先清理旧的 generate_video 任务数据（Phase 0 已废弃镜头级视频链路）
-- ============================================
DELETE FROM project_tasks WHERE task_type = 'generate_video';

ALTER TABLE project_tasks
  DROP CONSTRAINT IF EXISTS project_tasks_task_type_check;

ALTER TABLE project_tasks
  ADD CONSTRAINT project_tasks_task_type_check
  CHECK (task_type IN (
    'initialize_assets',
    'regenerate_story',
    'regenerate_characters',
    'regenerate_locations',
    'regenerate_style',
    'generate_script',
    'generate_storyboard',
    'generate_storyboard_episode',
    'generate_prompt',
    'generate_image',
    'generate_storyboard_asset',
    'generate_scene_video_prompt',
    'run_impact',
    'run_regen'
  ));

-- 更新唯一索引：generate_scene_video_prompt 也应唯一约束（同场景同时只允许一个）
DROP INDEX IF EXISTS idx_project_tasks_active_non_generation;

CREATE UNIQUE INDEX idx_project_tasks_active_non_generation
  ON project_tasks(project_id)
  WHERE status IN ('pending', 'running')
  AND task_type NOT IN ('generate_prompt', 'generate_image');

-- ============================================
-- 11. RLS 更新
--     11a. prompts 新增 scene_id 分支
--     11b. prompt_versions 新增 scene_id 分支
-- ============================================

-- 11a. prompts RLS 更新
DROP POLICY IF EXISTS "prompts_all_own" ON prompts;
CREATE POLICY "prompts_all_own" ON prompts
  FOR ALL USING (
    (shot_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM shots sh
      JOIN scenes s ON sh.scene_id = s.id
      JOIN episodes e ON s.episode_id = e.id
      WHERE sh.id = prompts.shot_id AND user_owns_project(e.project_id)
    ))
    OR
    (episode_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = prompts.episode_id AND user_owns_project(e.project_id)
    ))
    OR
    (scene_id IS NOT NULL AND scene_owns_project(scene_id))
  )
  WITH CHECK (
    (shot_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM shots sh
      JOIN scenes s ON sh.scene_id = s.id
      JOIN episodes e ON s.episode_id = e.id
      WHERE sh.id = prompts.shot_id AND user_owns_project(e.project_id)
    ))
    OR
    (episode_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = prompts.episode_id AND user_owns_project(e.project_id)
    ))
    OR
    (scene_id IS NOT NULL AND scene_owns_project(scene_id))
  );

-- 11b. prompt_versions RLS 更新
DROP POLICY IF EXISTS "versions_all_own" ON prompt_versions;
CREATE POLICY "versions_all_own" ON prompt_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM prompts p
      WHERE p.id = prompt_versions.prompt_id
      AND (
        (p.shot_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM shots sh
          JOIN scenes s ON sh.scene_id = s.id
          JOIN episodes e ON s.episode_id = e.id
          WHERE sh.id = p.shot_id AND user_owns_project(e.project_id)
        ))
        OR
        (p.episode_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM episodes e
          WHERE e.id = p.episode_id AND user_owns_project(e.project_id)
        ))
        OR
        (p.scene_id IS NOT NULL AND scene_owns_project(p.scene_id))
      )
    )
  );
