-- ============================================
-- Migration v29: projects.serialization_mode 连载模式
--
-- 对照原型 01-create.html Step1「连载模式」配置项：
--   continuous 连续剧情（集间强关联）
--   episodic   单元剧（每集独立故事）
--   mixed      混合（主线 + 单元）
--
-- 消费点：lib/ai-actions/episode-plot.ts 按 mode 决定逐集生成剧情时的上下文策略
-- ============================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS serialization_mode TEXT
  DEFAULT 'continuous'
  CHECK (serialization_mode IN ('continuous', 'episodic', 'mixed'));
