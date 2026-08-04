-- ============================================
-- MVP 优化改造 Migration v2
-- 在 Supabase SQL Editor 中执行此文件
-- 对应计划：Phase 1 数据库 Migration
-- ============================================

-- M1: episodes 增加状态字段（含 generating/failed）
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'
  CHECK (status IN ('draft', 'generating', 'storyboarded', 'completed', 'failed'));

-- M2: prompt_templates 增加 output_language
ALTER TABLE prompt_templates ADD COLUMN IF NOT EXISTS output_language TEXT DEFAULT 'zh'
  CHECK (output_language IN ('zh', 'en', 'mixed'));

-- M3: prompt_templates 增加 provider 字段
ALTER TABLE prompt_templates ADD COLUMN IF NOT EXISTS provider TEXT;

-- M4: scripts 增加 episode_outline
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS episode_outline JSONB DEFAULT '[]';

-- M5: prompts 增加 source_prompt_id（视频 Prompt 追溯来源图片 Prompt）
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS source_prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL;

-- M6: prompt_templates 唯一约束加入 provider（支持同 platform 不同 provider）
ALTER TABLE prompt_templates DROP CONSTRAINT IF EXISTS prompt_templates_platform_prompt_type_language_key;
ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_provider_platform_type_lang_key
  UNIQUE (provider, platform, prompt_type, language);

-- M7: episodes 复合索引（按项目 + 状态查询，支持并发生成检查）
CREATE INDEX IF NOT EXISTS idx_episodes_project_status ON episodes(project_id, status);

-- ============================================
-- 数据更新
-- ============================================

-- D1: 更新现有模板的 output_language 和 provider
UPDATE prompt_templates SET output_language = 'zh', provider = 'jimeng' WHERE platform = 'jimeng';
UPDATE prompt_templates SET output_language = 'en', provider = 'midjourney' WHERE platform = 'midjourney';
UPDATE prompt_templates SET output_language = 'en', provider = 'flux' WHERE platform = 'flux';
UPDATE prompt_templates SET output_language = 'en', provider = 'comfyui' WHERE platform = 'comfyui';
UPDATE prompt_templates SET output_language = 'zh', provider = 'kuaishou' WHERE platform = 'kling';
UPDATE prompt_templates SET output_language = 'en', provider = 'runway' WHERE platform = 'runway';
UPDATE prompt_templates SET output_language = 'zh', provider = 'ltx' WHERE platform = 'ltx';

-- D2: 新增 OpenAI 图片平台模板
INSERT INTO prompt_templates (platform, provider, prompt_type, language, system_rule, output_format, output_language, is_active)
VALUES (
  'openai_image', 'openai', 'image', 'zh',
  'OpenAI Image适配：中文自然语言描述，段落式，注重画面细节、人物外貌和氛围。角色描述使用中文，摄影技术术语可中英混合。生成可直接用于 GPT Image / DALL-E 的图片描述。',
  '中文自然语言段落式描述',
  'mixed', true
)
ON CONFLICT (provider, platform, prompt_type, language) DO NOTHING;

-- D3: 新增豆包视频平台模板
INSERT INTO prompt_templates (platform, provider, prompt_type, language, system_rule, output_format, output_language, is_active)
VALUES (
  'doubao_video', 'volcengine', 'video', 'zh',
  '豆包视频适配：中文运动描述，分镜头运动/人物动作/环境变化/视频参数。注重运动连续性和画面一致性。基于提供的图片描述生成视频运动描述。',
  '中文段落式运动描述',
  'zh', true
)
ON CONFLICT (provider, platform, prompt_type, language) DO NOTHING;

-- D4: 新增即梦视频平台模板
INSERT INTO prompt_templates (platform, provider, prompt_type, language, system_rule, output_format, output_language, is_active)
VALUES (
  'jimeng_video', 'jimeng', 'video', 'zh',
  '即梦视频适配：中文运动描述，注重画面连续性、人物动作流畅度和场景过渡。基于提供的图片描述生成视频运动描述。',
  '中文段落式运动描述',
  'zh', true
)
ON CONFLICT (provider, platform, prompt_type, language) DO NOTHING;
