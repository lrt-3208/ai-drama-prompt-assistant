-- ============================================
-- Migration v25: 项目高级配置 — 生成数量可定制化
-- projects 表新增 generation_config JSONB 字段
-- 存储角色/场景/集数/每集场景数/每场景镜头数的 min-max 范围
-- ============================================

-- 1. projects 表新增 generation_config 字段
ALTER TABLE projects ADD COLUMN IF NOT EXISTS generation_config JSONB DEFAULT NULL;

COMMENT ON COLUMN projects.generation_config IS '生成数量配置，JSON 格式：character_count/location_count/episode_count/scenes_per_episode/shots_per_scene，每项含 min/max';
