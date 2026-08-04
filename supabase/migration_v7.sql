-- ============================================
-- Migration v7: ai_config 扩展 provider/api_base/api_key 列
-- ============================================
-- 执行后在设置页面手动填入 provider/api_base/api_key 即可

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS api_base TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS api_key TEXT;
