-- ============================================
-- Migration v28: 剧本架构重构 Phase 1 — episodes 表提升为剧情载体
--
-- 目标架构（原型 04 + 08-dependency）：
--   每集独立持有「剧情大纲」与「分镜大纲」，各自带版本号，
--   逐集独立生成；下游分镜/画面指令依据版本号判定过期。
--
-- 本迁移是【纯增量】：只新增列 + 回填数据，
--   不删除、不改名、不修改任何现有列的语义。
--   episodes.status 保持原语义（draft/generating/storyboarded/failed），
--   状态机改造留待 Phase 2 与 storyboard.ts 同步进行。
-- ============================================

-- ============================================
-- 1. episodes 表新增剧情大纲字段（① 剧情层）
-- ============================================

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS plot_outline        JSONB;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS plot_version        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS plot_updated_at     TIMESTAMPTZ;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS plot_change_summary TEXT;

COMMENT ON COLUMN episodes.plot_outline        IS '本集剧情大纲（NULL = 未生成）。结构：{ opening, turning_point, conflict, ending, core_conflict, emotional_tone, characters[] }';
COMMENT ON COLUMN episodes.plot_version        IS '剧情大纲版本号，每次 AI 优化/手动编辑 +1，驱动下游过期判定';
COMMENT ON COLUMN episodes.plot_updated_at     IS '剧情大纲最后修改时间，用于过期提示展示';
COMMENT ON COLUMN episodes.plot_change_summary IS 'AI 生成的变更摘要，用于向用户说明「改了什么」';

-- ============================================
-- 2. episodes 表新增分镜大纲字段（② 分镜规划层）
-- ============================================

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS shot_outline           JSONB;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS outline_version        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS outline_updated_at     TIMESTAMPTZ;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS outline_change_summary TEXT;

COMMENT ON COLUMN episodes.shot_outline           IS '本集分镜大纲（NULL = 未生成）。将剧情拆为可拍摄场景规划：{ scenes: [{ scene_number, title, location, shot_count_estimate, emotion, key_shots[] }] }';
COMMENT ON COLUMN episodes.outline_version        IS '分镜大纲版本号，硬依赖 plot_version；剧情变更后本层标记「上游脏」';
COMMENT ON COLUMN episodes.outline_updated_at     IS '分镜大纲最后修改时间';
COMMENT ON COLUMN episodes.outline_change_summary IS '分镜大纲变更摘要，如「镜头 7→9，新增特效镜头」';

-- ============================================
-- 3. episodes 表新增分镜内容版本（③ 实际 scenes/shots 层）
-- ============================================

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS storyboard_version    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS storyboard_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN episodes.storyboard_version    IS '分镜内容（scenes + shots）版本号，重新生成分镜时 +1，使该集画面指令过期';
COMMENT ON COLUMN episodes.storyboard_updated_at IS '分镜内容最后生成时间';

-- ============================================
-- 3b. 「上游脏」判定基线（原型 08 的 markUpstreamDirty 规则）
--
--   版本号对比只能发现【被直接修改】的节点。但有一类节点版本号没变、
--   语义上却已过时 —— 因为它是从一个已变更的上游推导出来的。
--   要能计算它，必须记录「本层生成时，上游是哪个版本」。
--
--   判定式：
--     分镜大纲上游脏 = outline_based_on_plot_version    < plot_version
--     分镜内容上游脏 = storyboard_based_on_outline_version < outline_version
-- ============================================

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS outline_based_on_plot_version      INTEGER;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS storyboard_based_on_outline_version INTEGER;

COMMENT ON COLUMN episodes.outline_based_on_plot_version       IS '生成分镜大纲时所依据的 plot_version。小于当前 plot_version 即「上游脏」（剧情已变但大纲未重跑）';
COMMENT ON COLUMN episodes.storyboard_based_on_outline_version IS '生成分镜内容时所依据的 outline_version。小于当前 outline_version 即「上游脏」';

-- 索引：按项目查该集剧情就绪情况（画面指令页/分镜页高频查询）
CREATE INDEX IF NOT EXISTS idx_episodes_project_plot
  ON episodes(project_id, episode_number)
  WHERE plot_outline IS NOT NULL;

-- ============================================
-- 4. 数据回填：scripts.episode_outline → episodes 行
--
--    原格式：scripts.episode_outline = [{ episode, title, outline }, ...]
--    目标：每项成为一个 episodes 行的 plot_outline
--
--    注意：episodes 行此前只在「生成分镜」时创建，
--    所以大量集在 episodes 表中并不存在 —— 需要补建骨架行。
--    已存在的行只补 plot_outline，不动 title/status（避免覆盖已生成分镜的集）。
-- ============================================

DO $$
DECLARE
  v_inserted INTEGER := 0;
  v_updated  INTEGER := 0;
BEGIN
  -- 4a. 补建缺失的 episodes 骨架行
  WITH outline_items AS (
    SELECT
      s.project_id,
      (item->>'episode')::INTEGER          AS episode_number,
      NULLIF(item->>'title', '')           AS title,
      NULLIF(item->>'outline', '')         AS outline_text
    FROM scripts s
    CROSS JOIN LATERAL jsonb_array_elements(s.episode_outline) AS item
    WHERE s.episode_outline IS NOT NULL
      AND jsonb_typeof(s.episode_outline) = 'array'
      AND (item->>'episode') ~ '^\d+$'
  ),
  ins AS (
    INSERT INTO episodes (
      project_id, episode_number, title,
      plot_outline, plot_version, plot_updated_at, status
    )
    SELECT
      oi.project_id,
      oi.episode_number,
      oi.title,
      jsonb_build_object('summary', oi.outline_text, 'migrated_from', 'scripts.episode_outline'),
      1,
      now(),
      'draft'
    FROM outline_items oi
    WHERE oi.outline_text IS NOT NULL
    ON CONFLICT (project_id, episode_number) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  -- 4b. 为已存在但缺 plot_outline 的行回填（不动 title / status）
  WITH outline_items AS (
    SELECT
      s.project_id,
      (item->>'episode')::INTEGER  AS episode_number,
      NULLIF(item->>'outline', '') AS outline_text
    FROM scripts s
    CROSS JOIN LATERAL jsonb_array_elements(s.episode_outline) AS item
    WHERE s.episode_outline IS NOT NULL
      AND jsonb_typeof(s.episode_outline) = 'array'
      AND (item->>'episode') ~ '^\d+$'
  ),
  upd AS (
    UPDATE episodes e
    SET plot_outline    = jsonb_build_object('summary', oi.outline_text, 'migrated_from', 'scripts.episode_outline'),
        plot_updated_at = COALESCE(e.plot_updated_at, now())
    FROM outline_items oi
    WHERE e.project_id     = oi.project_id
      AND e.episode_number = oi.episode_number
      AND e.plot_outline IS NULL
      AND oi.outline_text IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM upd;

  RAISE NOTICE 'migration_v28 回填完成：新建 % 行骨架，回填 % 行已有集', v_inserted, v_updated;
END $$;

-- ============================================
-- 5. 已生成分镜的集：补 storyboard_updated_at 基线
--    status='storyboarded' 说明分镜内容已存在，用 updated_at 作为近似时间
-- ============================================

UPDATE episodes
SET storyboard_updated_at = COALESCE(storyboard_updated_at, updated_at)
WHERE status = 'storyboarded'
  AND storyboard_updated_at IS NULL;

-- ============================================
-- 注意：scripts 表保持原样，一列未动
--   synopsis / genre / characters / relationships / worldview 仍是项目级元数据的来源，
--   episode_outline / plot_outline 暂作为回填数据源与回滚依据保留。
--   待 Phase 2-4 全部消费方切换到 episodes 表后，再单独评估清理。
-- ============================================
