-- ============================================
-- Migration v23: Storyboard Document 重构
-- 1. assistant_prompt → document (JSONB)
-- 2. storyboard_image 标记 deprecated（保留字段不删除）
-- 注意：旧数据为纯文本（非 JSON），不兼容，直接置 NULL
-- ============================================

-- storyboards 表：先移除 NOT NULL 约束，再用 USING NULL::jsonb 直接转换
ALTER TABLE storyboards ALTER COLUMN assistant_prompt DROP NOT NULL;
ALTER TABLE storyboards
  ALTER COLUMN assistant_prompt TYPE JSONB USING NULL::jsonb;
ALTER TABLE storyboards
  RENAME COLUMN assistant_prompt TO document;

-- storyboard_versions 表：同步处理（该表 assistant_prompt 有 NOT NULL 约束）
ALTER TABLE storyboard_versions ALTER COLUMN assistant_prompt DROP NOT NULL;
ALTER TABLE storyboard_versions
  ALTER COLUMN assistant_prompt TYPE JSONB USING NULL::jsonb;
ALTER TABLE storyboard_versions
  RENAME COLUMN assistant_prompt TO document;

-- storyboard_image 保留字段，标记 deprecated
-- 不参与 Storyboard Document 生成
-- 不参与 Scene Video Prompt 生成
-- 未来可改用途：Storyboard Cover Image（封面图）
COMMENT ON COLUMN storyboards.storyboard_image IS 'DEPRECATED: 不再参与核心流程，未来可改用途为封面图';
