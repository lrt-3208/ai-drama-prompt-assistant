-- ============================================
-- Migration v18: 场景级任务并发优化
--     将 generate_storyboard_asset / generate_scene_video_prompt
--     从"项目级唯一约束"改为"场景级唯一约束"
--     不同场景的任务可并行执行，同一场景仍互斥
-- ============================================

-- 1. 删除旧的项目级唯一索引
DROP INDEX IF EXISTS idx_project_tasks_active_non_generation;

-- 2. 项目级唯一索引：仅约束重型任务（regenerate_* / generate_script 等）
--    这些任务影响全局数据，同一项目同时只允许一个
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
    'generate_storyboard_episode',
    'run_impact',
    'run_regen'
  );

-- 3. 场景级唯一索引：generate_storyboard_asset / generate_scene_video_prompt
--    按 (project_id, sceneId) 唯一约束，不同场景可并行
--    同一场景同时只允许一个场景级任务（因为场景视频 Prompt 依赖 Storyboard 完成）
CREATE UNIQUE INDEX idx_project_tasks_active_scene
  ON project_tasks(project_id, (payload->>'sceneId'))
  WHERE status IN ('pending', 'running')
  AND task_type IN ('generate_storyboard_asset', 'generate_scene_video_prompt');

-- 说明：
--   generate_prompt / generate_image / evaluate_prompt 不受任何唯一约束
--   （它们是轻量级任务，天然支持并发）
