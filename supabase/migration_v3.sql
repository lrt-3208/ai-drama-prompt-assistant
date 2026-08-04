-- ============================================
-- 资产初始化 Migration v3
-- 在 Supabase SQL Editor 中执行此文件
-- 对应计划：Phase 1 数据库 Migration
-- ============================================

-- M1: characters 表增加 role 字段
ALTER TABLE characters ADD COLUMN IF NOT EXISTS role TEXT;
COMMENT ON COLUMN characters.role IS '角色类型：主角/配角/反派';

-- M1b: characters 表增加 ai_key 字段（未来 merge 升级预留）
ALTER TABLE characters ADD COLUMN IF NOT EXISTS ai_key TEXT;
COMMENT ON COLUMN characters.ai_key IS 'AI 生成的唯一标识，用于未来 merge 升级匹配（MVP 先按 name+role 匹配）';

-- M2: projects 表增加 asset_status 字段（含 partial 状态）
ALTER TABLE projects ADD COLUMN IF NOT EXISTS asset_status TEXT DEFAULT 'draft'
  CHECK (asset_status IN ('draft', 'initializing', 'initialized', 'partial', 'failed'));
COMMENT ON COLUMN projects.asset_status IS '资产初始化状态';

-- M3: projects 表增加 asset_error 字段（记录初始化失败原因）
ALTER TABLE projects ADD COLUMN IF NOT EXISTS asset_error JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN projects.asset_error IS '资产初始化失败详情，如 {"location":"timeout","style":"AI解析失败"}';

-- M4: projects 表增加 asset_progress 字段（记录各步骤实时状态）
ALTER TABLE projects ADD COLUMN IF NOT EXISTS asset_progress JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN projects.asset_progress IS '各步骤实时状态，如 {"story":"success","characters":"running","locations":"pending","style":"failed"}';

-- ============================================
-- 数据更新
-- ============================================

-- D1: 更新现有项目的 asset_status
UPDATE projects SET asset_status = 'draft' WHERE asset_status IS NULL;

-- D2: 更新现有项目的 asset_error 和 asset_progress
UPDATE projects SET asset_error = '{}'::jsonb WHERE asset_error IS NULL;
UPDATE projects SET asset_progress = '{}'::jsonb WHERE asset_progress IS NULL;
