-- ============================================
-- Migration v16: project_tasks task_type CHECK 扩展
--     新增：evaluate_prompt（Prompt 质量评分任务）
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
    'generate_storyboard_asset',
    'generate_scene_video_prompt',
    'run_impact',
    'run_regen',
    'evaluate_prompt'
  ));

-- ============================================
-- 更新唯一索引：evaluate_prompt 视为轻量级任务，允许并发
-- （与 generate_prompt / generate_image 同等对待）
-- ============================================
DROP INDEX IF EXISTS idx_project_tasks_active_non_generation;

CREATE UNIQUE INDEX idx_project_tasks_active_non_generation
  ON project_tasks(project_id)
  WHERE status IN ('pending','running')
  AND task_type NOT IN ('generate_prompt', 'generate_image', 'evaluate_prompt');
