-- ============================================
-- 任务驱动架构 Migration v5
-- 在 Supabase SQL Editor 中执行此文件
-- ============================================

-- 1. project_tasks 表
CREATE TABLE IF NOT EXISTS project_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type    TEXT NOT NULL DEFAULT 'initialize_assets'
                CHECK (task_type IN ('initialize_assets', 'regenerate_characters', 'regenerate_locations', 'regenerate_style')),
  payload      JSONB DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'success', 'partial', 'failed')),
  progress     JSONB DEFAULT '{}'::jsonb,
  result       JSONB,
  error        JSONB,
  attempt      INTEGER DEFAULT 0,
  locked_at    TIMESTAMPTZ,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN project_tasks.payload IS '任务参数，如 {} 全量初始化，{characterIds: [...]} 重新生成角色';
COMMENT ON COLUMN project_tasks.progress IS '各步骤状态：{story:"success","characters":"running",...}';
COMMENT ON COLUMN project_tasks.result IS '完成后摘要：{characters:5, locations:4}';
COMMENT ON COLUMN project_tasks.error IS '失败详情：{characters:"API 限流: ..."}';
COMMENT ON COLUMN project_tasks.attempt IS '重试次数';
COMMENT ON COLUMN project_tasks.locked_at IS '最后一次 heartbeat 时间戳，用于僵尸判断';
COMMENT ON COLUMN project_tasks.started_at IS '任务开始执行时间';

-- 防重复：同一项目同时只能有一个 pending/running 任务
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_tasks_active
  ON project_tasks(project_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS idx_project_tasks_pending
  ON project_tasks(status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_project_tasks_user ON project_tasks(user_id);

-- updated_at 触发器
SELECT create_updated_at_trigger('project_tasks');

-- RLS
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "project_tasks_all_own" ON project_tasks;
CREATE POLICY "project_tasks_all_own" ON project_tasks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================
-- 2. lock_project_task RPC — 原子锁定 + attempt+1
-- ============================================
-- 一次完成：pending → running + attempt+1 + locked_at + started_at
-- 避免分两次 update 导致的数据不完整

CREATE OR REPLACE FUNCTION lock_project_task(p_task_id UUID)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  user_id UUID,
  task_type TEXT,
  payload JSONB,
  attempt INTEGER
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE project_tasks
  SET
    status = 'running',
    attempt = attempt + 1,
    locked_at = now(),
    started_at = now()
  WHERE
    id = p_task_id
    AND status = 'pending'
  RETURNING
    id, project_id, user_id, task_type, payload, attempt;
$$;

-- ============================================
-- 3. merge_task_progress RPC — JSONB merge 更新
-- ============================================
-- progress = progress || patch，只覆盖同 key，不丢失其他 key

CREATE OR REPLACE FUNCTION merge_task_progress(p_task_id UUID, p_patch JSONB)
RETURNS void
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE project_tasks
  SET progress = progress || p_patch
  WHERE id = p_task_id;
$$;

-- ============================================
-- 4. heartbeat_task RPC — 更新 locked_at
-- ============================================
-- runner 执行过程中每 30s 调用，证明存活

CREATE OR REPLACE FUNCTION heartbeat_task(p_task_id UUID)
RETURNS void
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE project_tasks
  SET locked_at = now()
  WHERE id = p_task_id AND status = 'running';
$$;
