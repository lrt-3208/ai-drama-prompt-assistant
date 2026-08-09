-- ============================================
-- Migration v19: 修复 storyboard_versions is_current 重复问题
--   0. 删除错误的 updated_at 触发器（表无 updated_at 列，导致 UPDATE 静默失败）
--   1. 修复存量数据：每个 storyboard 只保留 version_number 最高的 is_current=true
--   2. 添加部分唯一索引：防止未来出现多个 is_current=true
-- ============================================

-- ============================================
-- 0. 删除错误的 updated_at 触发器
--    migration_v17 调用 create_updated_at_trigger('storyboard_versions')
--    但该表没有 updated_at 列，导致每次 UPDATE 都报错
--    这正是 is_current 重复的根因：UPDATE 失败 + INSERT 成功
-- ============================================
DROP TRIGGER IF EXISTS storyboard_versions_updated_at ON storyboard_versions;

-- ============================================
-- 1. 修复存量数据
--    对于每个 storyboard，如果有多条 is_current=true 的版本，
--    只保留 version_number 最高的那条，其余置为 false
-- ============================================

-- 找出每个 storyboard 中 version_number 最高的 is_current 版本 ID
-- 其余 is_current=true 的版本置为 false
UPDATE storyboard_versions
SET is_current = false
WHERE is_current = true
  AND id NOT IN (
    SELECT keep_id FROM (
      SELECT
        id AS keep_id,
        storyboard_id,
        version_number,
        ROW_NUMBER() OVER (PARTITION BY storyboard_id ORDER BY version_number DESC) AS rn
      FROM storyboard_versions
      WHERE is_current = true
    ) ranked
    WHERE rn = 1
  );

-- 如果一个 storyboard 没有任何 is_current=true 的版本，
-- 把 version_number 最高的那个设为 current
UPDATE storyboard_versions
SET is_current = true
WHERE id IN (
  SELECT keep_id FROM (
    SELECT
      id AS keep_id,
      storyboard_id,
      version_number,
      ROW_NUMBER() OVER (PARTITION BY storyboard_id ORDER BY version_number DESC) AS rn
    FROM storyboard_versions sv1
    WHERE NOT EXISTS (
      SELECT 1 FROM storyboard_versions sv2
      WHERE sv2.storyboard_id = sv1.storyboard_id
        AND sv2.is_current = true
    )
  ) ranked
  WHERE rn = 1
);

-- ============================================
-- 2. 添加部分唯一索引
--    确保每个 storyboard 最多只有一条 is_current=true
-- ============================================

DROP INDEX IF EXISTS idx_sb_versions_one_current;
CREATE UNIQUE INDEX idx_sb_versions_one_current
  ON storyboard_versions(storyboard_id)
  WHERE is_current = true;
