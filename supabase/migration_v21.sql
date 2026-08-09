-- ============================================
-- Migration v21: 分集分镜并发优化
--     将 generate_storyboard_episode 从"项目级唯一约束"改为"集级唯一约束"
--     不同集的分镜生成可并行执行，同一集仍互斥
-- ============================================

-- 1. 删除旧的项目级唯一索引（包含 generate_storyboard_episode）
DROP INDEX IF EXISTS idx_project_tasks_active_heavy;

-- 2. 重建项目级唯一索引：仅约束重型全局任务（不含 generate_storyboard_episode）
CREATE UNIQUE INDEX idx_project_tasks_active_heavy
  ON project_tasks(project_id)
  WHERE status IN ('pending', 'running')
  AND task_type IN (
    'initialize_assets',
    'regenerate_story',
    'regenerate_characters',
    'regenerate_locations',
    'regenerate_style',
    'generate_script',
    'generate_storyboard',
    'run_impact',
    'run_regen'
  );

-- 3. 新增集级唯一索引：generate_storyboard_episode 按 (project_id, episodeNumber) 唯一约束
--    不同集可并行生成，同一集同时只允许一个任务
CREATE UNIQUE INDEX idx_project_tasks_active_episode
  ON project_tasks(project_id, (payload->>'episodeNumber'))
  WHERE status IN ('pending', 'running')
  AND task_type = 'generate_storyboard_episode';

-- 说明：
--   idx_project_tasks_active_scene（场景级）和轻量级任务不受影响
