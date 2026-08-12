-- ============================================
-- Migration v24: 故事板图片生成优化
-- 1. storyboards 表新增 storyboard_image_asset_id + optimized_image_prompt
-- 2. 删除已废弃的 storyboard_image 字段
-- 3. project_tasks task_type CHECK 扩展：新增 generate_storyboard_image
-- 4. 场景级唯一索引扩展：generate_storyboard_image 加入场景级互斥
-- ============================================

-- 1. storyboards 表新增字段
ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS storyboard_image_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE storyboards ADD COLUMN IF NOT EXISTS optimized_image_prompt TEXT;

-- 2. 删除已废弃的 storyboard_image 文本字段
ALTER TABLE storyboards DROP COLUMN IF EXISTS storyboard_image;

COMMENT ON COLUMN storyboards.storyboard_image_asset_id IS '优化后的故事板图片 asset ID';
COMMENT ON COLUMN storyboards.optimized_image_prompt IS '故事板图片优化提示词（英文，程序化生成）';

-- 3. project_tasks task_type CHECK 扩展：新增 generate_storyboard_image
ALTER TABLE project_tasks
  DROP CONSTRAINT IF EXISTS project_tasks_task_type_check;
ALTER TABLE project_tasks
  ADD CONSTRAINT project_tasks_task_type_check CHECK (task_type IN (
    'initialize_assets', 'regenerate_story', 'regenerate_characters', 'regenerate_locations',
    'regenerate_style', 'generate_script', 'generate_storyboard', 'generate_storyboard_episode',
    'generate_prompt', 'generate_image', 'generate_storyboard_asset', 'generate_scene_video_prompt',
    'run_impact', 'run_regen', 'evaluate_prompt', 'generate_storyboard_image'
  ));

-- 4. 场景级唯一索引扩展：generate_storyboard_image 加入场景级互斥
DROP INDEX IF EXISTS idx_project_tasks_active_scene;
CREATE UNIQUE INDEX idx_project_tasks_active_scene
  ON project_tasks(project_id, (payload->>'sceneId'))
  WHERE status IN ('pending', 'running')
  AND task_type IN ('generate_storyboard_asset', 'generate_scene_video_prompt', 'generate_storyboard_image');
