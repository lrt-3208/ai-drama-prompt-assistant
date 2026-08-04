-- ============================================
-- Migration v6: 扩展 task_type + ai_config 全局配置表
-- ============================================

-- 1. 扩展 task_type CHECK 约束
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
    'generate_prompt'
  ));

-- 2. ai_config 全局配置表（单行，id=1）
CREATE TABLE IF NOT EXISTS ai_config (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  model      TEXT,
  temperature REAL DEFAULT 0.3,
  max_tokens  INTEGER DEFAULT 4096,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ai_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 直接 DDL 创建 trigger（避免 PL/pgSQL 函数内 DROP/CREATE 死锁）
CREATE OR REPLACE TRIGGER ai_config_updated_at
  BEFORE UPDATE ON ai_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_config_rw ON ai_config FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
