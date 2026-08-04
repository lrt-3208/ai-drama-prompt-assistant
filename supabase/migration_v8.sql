-- ============================================
-- Migration v8: 允许 generate_prompt 任务并发执行
-- 旧索引：每项目只允许 1 个活跃任务（所有类型）
-- 新索引：非 prompt 类型仍保持 1 个限制，prompt 类型可并发
-- ============================================

-- 1. 删除旧索引（每项目唯一活跃任务）
DROP INDEX IF EXISTS idx_project_tasks_active;

-- 2. 新索引：非 generate_prompt 类型仍保持唯一约束
CREATE UNIQUE INDEX idx_project_tasks_active_non_prompt
  ON project_tasks(project_id)
  WHERE status IN ('pending', 'running') AND task_type != 'generate_prompt';

-- 3. generate_prompt 类型无唯一约束，可并发
--    （不加索引 = 允许同一项目多个 prompt 任务同时 pending/running）
