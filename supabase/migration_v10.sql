-- ============================================
-- Migration v10: 删除旧 ai_config 全局配置表
-- 前提条件：所有代码已迁移到 user_ai_models，grep 验证零引用
-- ============================================

-- 删除旧索引和 trigger（如果存在）
DROP TRIGGER IF EXISTS ai_config_updated_at ON ai_config;
DROP POLICY IF EXISTS ai_config_rw ON ai_config;

-- 删除旧表
DROP TABLE IF EXISTS ai_config;
