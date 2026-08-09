-- ============================================
-- Migration v9: 用户级 AI 模型配置 + project_tasks 生成任务类型预留
-- 1. 创建 user_ai_models 表（替代 ai_config 全局表）
-- 2. 修改 project_tasks task_type CHECK（预留 generate_image / generate_video）
-- 3. 更新 project_tasks 唯一索引（生成类任务可并发）
-- 注意：ai_config 表暂不删除，Phase 1c 验证零引用后再 DROP
-- ============================================

-- ============================================
-- 1. user_ai_models — 用户 AI 模型配置表
-- ============================================
CREATE TABLE IF NOT EXISTS user_ai_models (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'qwen',
  model        TEXT NOT NULL,
  modality     TEXT NOT NULL DEFAULT 'text'
               CHECK (modality IN ('text', 'image', 'video')),
  api_base     TEXT,
  api_key      TEXT,
  temperature  REAL DEFAULT 0.3,
  max_tokens   INTEGER DEFAULT 4096,
  is_default   BOOLEAN DEFAULT false,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_ai_models_user_id ON user_ai_models(user_id);

-- 每个用户每个 modality 只能有一个 is_default=true 且 is_active=true
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ai_models_single_default
  ON user_ai_models(user_id, modality)
  WHERE is_default = true AND is_active = true;

-- updated_at trigger
CREATE OR REPLACE TRIGGER user_ai_models_updated_at
  BEFORE UPDATE ON user_ai_models
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE user_ai_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_ai_models_select ON user_ai_models FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY user_ai_models_insert ON user_ai_models FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_ai_models_update ON user_ai_models FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_ai_models_delete ON user_ai_models FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- 2. project_tasks task_type CHECK 扩展
--    预留 generate_image / generate_video（Phase 4 使用）
-- ============================================
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
    'generate_video'
  ));

-- ============================================
-- 3. project_tasks 唯一索引更新
--    旧索引：非 generate_prompt 类型保持唯一约束
--    新索引：非生成类（generate_prompt/image/video）保持唯一约束
--    生成类任务可并发执行
-- ============================================
DROP INDEX IF EXISTS idx_project_tasks_active_non_prompt;

CREATE UNIQUE INDEX idx_project_tasks_active_non_generation
  ON project_tasks(project_id)
  WHERE status IN ('pending', 'running')
  AND task_type NOT IN ('generate_prompt', 'generate_image', 'generate_video');
