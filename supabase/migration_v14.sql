-- ============================================
-- Migration v14: Phase 3 Prompt Engine 升级
-- 1. 新建 style_presets（全局风格预设库 + 6 条预置数据）
-- 2. 新建 prompt_generation_records（生成过程记录）
-- 3. 新建 prompt_template_versions（模板版本链）
-- 4. prompt_versions 扩展：negative_prompt + dependency_snapshot + source 补充 'regen'
-- ============================================

-- ============================================
-- 1. style_presets — 全局风格预设库
-- ============================================
CREATE TABLE IF NOT EXISTS style_presets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('cinematic','anime','realistic','artistic','sci-fi','fantasy','custom')),
  fixed_prompt    TEXT NOT NULL,
  negative_prompt TEXT,
  preview_url     TEXT,
  is_public       BOOLEAN DEFAULT false,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_style_presets_public ON style_presets(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_style_presets_user ON style_presets(user_id);
CREATE INDEX IF NOT EXISTS idx_style_presets_category ON style_presets(category);

SELECT create_updated_at_trigger('style_presets');

ALTER TABLE style_presets ENABLE ROW LEVEL SECURITY;

-- 公开预设所有人可读，私有预设只有 owner 可读
DROP POLICY IF EXISTS "style_presets_select" ON style_presets;
CREATE POLICY "style_presets_select" ON style_presets
  FOR SELECT USING (is_public = true OR user_id = auth.uid());

-- 只有 owner 可以增删改自己的预设
DROP POLICY IF EXISTS "style_presets_insert" ON style_presets;
CREATE POLICY "style_presets_insert" ON style_presets
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "style_presets_update" ON style_presets;
CREATE POLICY "style_presets_update" ON style_presets
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "style_presets_delete" ON style_presets;
CREATE POLICY "style_presets_delete" ON style_presets
  FOR DELETE USING (user_id = auth.uid());

-- 预置 6 条系统风格预设（is_public=true, user_id=NULL）
INSERT INTO style_presets (name, category, fixed_prompt, negative_prompt, is_public, user_id, sort_order) VALUES
(
  '电影质感',
  'cinematic',
  'cinematic shot, film grain, anamorphic lens flare, shallow depth of field, natural lighting, 35mm film texture, color graded, professional cinematography, dramatic shadows',
  'cartoon, anime, 3d render, low quality, blurry, overexposed, flat lighting, plastic skin',
  true, NULL, 1
),
(
  '动漫风格',
  'anime',
  'anime style, cel shading, vibrant colors, clean lineart, expressive eyes, dynamic composition, studio quality, key animation',
  'realistic, photographic, 3d render, live action, western cartoon, rough sketch, low quality',
  true, NULL, 2
),
(
  '写实风格',
  'realistic',
  'photorealistic, ultra-detailed, 8k resolution, natural skin texture, realistic lighting, professional photography, DSLR quality, sharp focus',
  'cartoon, anime, painting, 3d render, plastic skin, overprocessed, artificial lighting, low resolution',
  true, NULL, 3
),
(
  '油画风格',
  'artistic',
  'oil painting style, visible brush strokes, rich textures, classical composition, warm palette, renaissance lighting, canvas texture',
  'photographic, digital art, 3d render, flat colors, sharp edges, modern style',
  true, NULL, 4
),
(
  '水彩风格',
  'artistic',
  'watercolor painting, soft gradients, paper texture, flowing colors, delicate washes, light and airy, traditional media feel',
  'photographic, 3d render, oil painting, digital art, sharp lines, heavy shadows',
  true, NULL, 5
),
(
  '赛博朋克',
  'sci-fi',
  'cyberpunk aesthetic, neon lights, rain-soaked streets, holographic displays, dark atmosphere, futuristic technology, blade runner style, teal and magenta color palette',
  'medieval, fantasy, natural landscape, bright sunlight, pastel colors, minimal tech',
  true, NULL, 6
)
ON CONFLICT DO NOTHING;

-- ============================================
-- 2. prompt_generation_records — 生成过程记录
-- ============================================
CREATE TABLE IF NOT EXISTS prompt_generation_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id         UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version_id        UUID REFERENCES prompt_versions(id) ON DELETE SET NULL,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  input_context     JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id       UUID REFERENCES prompt_templates(id) ON DELETE SET NULL,
  template_version  INT,
  model             TEXT,
  variables         JSONB DEFAULT '{}'::jsonb,
  output_snapshot   TEXT,
  duration_ms       INT,
  prompt_tokens     INT,
  completion_tokens INT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pgr_prompt ON prompt_generation_records(prompt_id);
CREATE INDEX IF NOT EXISTS idx_pgr_project ON prompt_generation_records(project_id);
CREATE INDEX IF NOT EXISTS idx_pgr_template ON prompt_generation_records(template_id);

ALTER TABLE prompt_generation_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prompt_generation_records_all_own" ON prompt_generation_records;
CREATE POLICY "prompt_generation_records_all_own" ON prompt_generation_records
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));

-- ============================================
-- 3. prompt_template_versions — 模板版本链
-- ============================================
CREATE TABLE IF NOT EXISTS prompt_template_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id           UUID NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  version_number        INT NOT NULL,
  system_rule           TEXT NOT NULL,
  user_rule             TEXT,
  variables             JSONB DEFAULT '[]'::jsonb,
  negative_prompt_rule  TEXT,
  output_format         TEXT,
  example               TEXT,
  is_current            BOOLEAN DEFAULT false,
  source                TEXT DEFAULT 'system' CHECK (source IN ('system','manual','ai')),
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(template_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_ptv_template ON prompt_template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_ptv_current ON prompt_template_versions(template_id) WHERE is_current = true;

SELECT create_updated_at_trigger('prompt_template_versions');

-- prompt_template_versions 是全局的，所有认证用户可读
ALTER TABLE prompt_template_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prompt_template_versions_select" ON prompt_template_versions;
CREATE POLICY "prompt_template_versions_select" ON prompt_template_versions
  FOR SELECT TO authenticated USING (true);

-- 只有 admin 可以写入（暂时通过 service_role 绕过 RLS）
-- 生产环境可增加 is_admin() 判断

-- ============================================
-- 4. prompt_versions 扩展
--    4a. 新增 negative_prompt
--    4b. 新增 dependency_snapshot
--    4c. source CHECK 补充 'regen'
-- ============================================

-- 4a. negative_prompt
ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS negative_prompt TEXT;

-- 4b. dependency_snapshot
ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS dependency_snapshot JSONB;

-- 4c. source CHECK 扩展（补充 'regen'）
ALTER TABLE prompt_versions DROP CONSTRAINT IF EXISTS prompt_versions_source_check;
ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_source_check
  CHECK (source IN ('ai','manual','regen'));

COMMENT ON COLUMN prompt_versions.negative_prompt IS 'Negative Prompt 负面提示词';
COMMENT ON COLUMN prompt_versions.dependency_snapshot IS '依赖快照：记录引用的角色/场景/风格/Shot Prompt/Storyboard 的版本号';

-- ============================================
-- 5. projects 扩展：style_preset_id（当前选中的风格预设）
-- ============================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS style_preset_id UUID REFERENCES style_presets(id) ON DELETE SET NULL;

COMMENT ON COLUMN projects.style_preset_id IS '当前项目的风格预设';
