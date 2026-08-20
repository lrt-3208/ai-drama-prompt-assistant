-- ============================================
-- Migration v32: llm_prompt_templates 表
--
-- LLM 节点提示词配置化：
--   15 个 LLM 调用节点的 System Prompt 模板，支持用户级自定义
--   - user_id IS NULL  → 系统默认行（service_role 写入，seed 脚本从 lib/ai/node-registry.ts 导入）
--   - user_id = auth.uid() → 用户级行（版本化，is_current 标记当前生效版本）
--   - serialization_mode IS NULL → 通用模板；continuous/episodic/mixed → 连载模式专属
--
-- 生效优先级（代码内挑选，见 lib/ai/node-template-loader.ts）：
--   用户级(节点+模式精确) → 用户级(节点+通用) →
--   系统级(节点+模式精确) → 系统级(节点+通用) → 代码内置（node-registry 常量兜底）
--
-- 注意：与现有 prompt_templates / prompt_template_versions（image/scene_video prompt 体系）无关，第一期不迁移
-- ============================================

-- 1. 主表
CREATE TABLE llm_prompt_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = 系统默认
  node_key           TEXT NOT NULL,
  serialization_mode TEXT CHECK (serialization_mode IN ('continuous', 'episodic', 'mixed')),  -- NULL = 通用
  system_rule        TEXT NOT NULL,           -- 模板正文，支持 &变量 引用
  version_number     INT NOT NULL DEFAULT 1,
  is_current         BOOLEAN NOT NULL DEFAULT true,
  source             TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('system', 'user')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 索引
CREATE INDEX idx_llm_pt_lookup ON llm_prompt_templates(node_key, is_current);
CREATE INDEX idx_llm_pt_user ON llm_prompt_templates(user_id);
-- 同一 (user_id, node_key, serialization_mode) 下版本号唯一
CREATE UNIQUE INDEX idx_llm_pt_version_unique
  ON llm_prompt_templates(user_id, node_key, COALESCE(serialization_mode, ''), version_number);
-- 同一维度只有一个 is_current 版本（部分唯一索引，NULL serialization_mode 用 COALESCE 归一）
CREATE UNIQUE INDEX idx_llm_pt_current_unique
  ON llm_prompt_templates(user_id, node_key, COALESCE(serialization_mode, ''))
  WHERE is_current = true;

-- 3. RLS
ALTER TABLE llm_prompt_templates ENABLE ROW LEVEL SECURITY;

-- 读：系统默认行对所有登录用户可见；用户行仅本人可见
CREATE POLICY llm_pt_select ON llm_prompt_templates
  FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

-- 写：仅本人用户行
CREATE POLICY llm_pt_insert ON llm_prompt_templates
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY llm_pt_update ON llm_prompt_templates
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY llm_pt_delete ON llm_prompt_templates
  FOR DELETE
  USING (user_id = auth.uid());

-- 系统默认行（user_id IS NULL）由 service_role 写入（绕过 RLS），不设 policy

-- ============================================
-- 执行后：运行 npx tsx tests/seed-prompt-templates.ts 写入 15 行系统默认
-- ============================================
