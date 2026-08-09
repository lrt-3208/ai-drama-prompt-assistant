-- ============================================
-- Migration v12: Phase 0 架构清理
-- 1. 删除 characters 废字段（reference_image_url, ai_key）
-- 2. 放宽 characters.gender CHECK 约束
-- 3. 新增 characters.stable_key + is_locked
-- 4. 新增 locations.stable_key
-- 5. 新增 visual_styles.stable_key
-- 注意：ai_config 表已在 migration_v10 中删除
-- ============================================

-- ============================================
-- 1. characters — 删除废字段
-- ============================================
ALTER TABLE characters DROP COLUMN IF EXISTS reference_image_url;
ALTER TABLE characters DROP COLUMN IF EXISTS ai_key;

-- ============================================
-- 2. characters — 放宽 gender CHECK 约束
-- ============================================
DO $$
BEGIN
  -- 删除旧约束
  ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_gender_check;
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

ALTER TABLE characters ADD CONSTRAINT characters_gender_check
  CHECK (gender IS NULL OR gender IN ('男', '女', 'other'));

-- ============================================
-- 3. characters — 新增 stable_key + is_locked
--    stable_key: 后端生成的稳定标识，AI 禁止生成
--    命名格式: char_ + 5 位随机字母数字（如 char_a3f9b）
--    唯一性: 项目级唯一
-- ============================================
ALTER TABLE characters ADD COLUMN IF NOT EXISTS stable_key TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;

-- 为已有数据回填 stable_key（格式: char_ + 随机 5 位）
DO $$
DECLARE
  rec RECORD;
  new_key TEXT;
BEGIN
  FOR rec IN SELECT id FROM characters WHERE stable_key IS NULL LOOP
    new_key := 'char_' || substr(encode(gen_random_bytes(5), 'hex'), 1, 5);
    UPDATE characters SET stable_key = new_key WHERE id = rec.id AND stable_key IS NULL;
  END LOOP;
END$$;

-- 设置 NOT NULL 约束（回填后）
ALTER TABLE characters ALTER COLUMN stable_key SET NOT NULL;

-- 创建唯一索引（项目级唯一：同 project 内不重复）
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_stable_key
  ON characters(project_id, stable_key);

-- ============================================
-- 4. locations — 新增 stable_key
--    命名格式: location_ + 5 位随机字母数字
-- ============================================
ALTER TABLE locations ADD COLUMN IF NOT EXISTS stable_key TEXT;

DO $$
DECLARE
  rec RECORD;
  new_key TEXT;
BEGIN
  FOR rec IN SELECT id FROM locations WHERE stable_key IS NULL LOOP
    new_key := 'location_' || substr(encode(gen_random_bytes(5), 'hex'), 1, 5);
    UPDATE locations SET stable_key = new_key WHERE id = rec.id AND stable_key IS NULL;
  END LOOP;
END$$;

ALTER TABLE locations ALTER COLUMN stable_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_stable_key
  ON locations(project_id, stable_key);

-- ============================================
-- 5. visual_styles — 新增 stable_key
--    命名格式: style_ + 5 位随机字母数字
-- ============================================
ALTER TABLE visual_styles ADD COLUMN IF NOT EXISTS stable_key TEXT;

DO $$
DECLARE
  rec RECORD;
  new_key TEXT;
BEGIN
  FOR rec IN SELECT id FROM visual_styles WHERE stable_key IS NULL LOOP
    new_key := 'style_' || substr(encode(gen_random_bytes(5), 'hex'), 1, 5);
    UPDATE visual_styles SET stable_key = new_key WHERE id = rec.id AND stable_key IS NULL;
  END LOOP;
END$$;

ALTER TABLE visual_styles ALTER COLUMN stable_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visual_styles_stable_key
  ON visual_styles(project_id, stable_key);

-- ============================================
-- 注释
-- ============================================
COMMENT ON COLUMN characters.stable_key IS '后端生成的稳定标识，AI 禁止生成。格式: char_xxxxx。项目级唯一';
COMMENT ON COLUMN characters.is_locked IS '锁定角色，AI 重新生成时不覆盖';
COMMENT ON COLUMN locations.stable_key IS '后端生成的稳定标识，AI 禁止生成。格式: location_xxxxx。项目级唯一';
COMMENT ON COLUMN visual_styles.stable_key IS '后端生成的稳定标识，AI 禁止生成。格式: style_xxxxx。项目级唯一';
