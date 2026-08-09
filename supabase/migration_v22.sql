-- ============================================
-- Migration v22: 移除剧本版本表
-- script_versions 表无下游依赖（不影响分镜生成，分镜读 scripts 表）
-- ============================================

-- 1. 删除剧本版本表
DROP TABLE IF EXISTS script_versions;

-- 2. 删除 scripts 表上的 current_version_id 列
ALTER TABLE scripts DROP COLUMN IF EXISTS current_version_id;
