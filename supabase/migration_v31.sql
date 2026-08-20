-- ============================================
-- Migration v31: project_tasks task_type CHECK 扩展 + 集级任务互斥统一
--
-- 背景：Episode 维度重构新增两种集级任务类型，代码白名单
-- （app/api/projects/[id]/tasks/route.ts）已包含，但 v24 的 CHECK 约束
-- 未同步迁移，导致创建任务直接 500：
--   new row for relation "project_tasks" violates check constraint
--   "project_tasks_task_type_check"
--
-- 受影响任务：
--   generate_episode_plot    逐集剧情大纲（剧本 Tab）
--   generate_episode_outline 逐集分镜大纲（剧本 Tab）
--
-- 同时将 v21 的集级唯一索引从单一任务类型扩展为三种集级任务共用
-- (project_id, payload->>'episodeNumber') 活跃互斥
-- ============================================

-- 1. task_type CHECK 扩展：补 generate_episode_plot / generate_episode_outline
ALTER TABLE project_tasks
  DROP CONSTRAINT IF EXISTS project_tasks_task_type_check;
ALTER TABLE project_tasks
  ADD CONSTRAINT project_tasks_task_type_check CHECK (task_type IN (
    'initialize_assets', 'regenerate_story', 'regenerate_characters', 'regenerate_locations',
    'regenerate_style', 'generate_script', 'generate_episode_plot', 'generate_episode_outline',
    'generate_storyboard', 'generate_storyboard_episode', 'generate_prompt', 'generate_image',
    'generate_storyboard_asset', 'generate_scene_video_prompt', 'run_impact', 'run_regen',
    'evaluate_prompt', 'generate_storyboard_image'
  ));

-- 2. 集级唯一索引扩展：剧情大纲 / 分镜大纲 / 分镜内容 三种集级任务
--    同一集同时只允许一个活跃任务，不同集可并行
DROP INDEX IF EXISTS idx_project_tasks_active_episode;
CREATE UNIQUE INDEX idx_project_tasks_active_episode
  ON project_tasks(project_id, (payload->>'episodeNumber'))
  WHERE status IN ('pending', 'running')
  AND task_type IN ('generate_episode_plot', 'generate_episode_outline', 'generate_storyboard_episode');

-- 说明：
--   idx_project_tasks_active_heavy（项目级）与 idx_project_tasks_active_scene（场景级）不受影响
