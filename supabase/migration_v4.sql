-- ============================================
-- Migration V4: locations 表增加 sort_order 字段
-- 在 Supabase SQL Editor 中执行
-- ============================================

-- locations 表增加 sort_order 字段（与 characters 表一致）
ALTER TABLE locations ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
COMMENT ON COLUMN locations.sort_order IS '场景排序顺序';

-- 刷新 Supabase schema cache（解决 "Could not find the 'sort_order' column" 错误）
NOTIFY psql_logs, 'Schema cache refreshed';
