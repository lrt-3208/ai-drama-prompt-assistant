-- ============================================
-- AI 短剧 Prompt 助手 - 数据库迁移脚本
-- 在 Supabase SQL Editor 中执行此文件
-- ============================================

-- 1. profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT,
  avatar_url TEXT,
  preferred_ai_model TEXT DEFAULT 'deepseek',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. projects (先不加 visual_style_id 外键，避免循环依赖)
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  synopsis TEXT,
  genre TEXT,
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft','scripting','asset_building','storyboarding','prompting','completed','deleted')),
  visual_style_id UUID,
  cover_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- 3. stories
CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_input TEXT NOT NULL,
  input_mode TEXT DEFAULT 'story' CHECK (input_mode IN ('story','paste')),
  theme TEXT,
  genre TEXT,
  core_conflict TEXT,
  target_emotion TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. characters
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INT,
  gender TEXT CHECK (gender IN ('男','女')),
  appearance TEXT,
  personality TEXT,
  background TEXT,
  clothing TEXT,
  fixed_prompt TEXT NOT NULL,
  reference_image_url TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_characters_project_id ON characters(project_id);

-- 5. locations
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  environment TEXT,
  time TEXT,
  weather TEXT,
  color_style TEXT,
  fixed_prompt TEXT NOT NULL,
  reference_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_locations_project_id ON locations(project_id);

-- 6. visual_styles
CREATE TABLE IF NOT EXISTS visual_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  camera_style TEXT,
  color TEXT,
  lighting TEXT,
  cinematography TEXT,
  fixed_prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 补充 projects.visual_style_id 外键
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'projects_visual_style_id_fkey'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_visual_style_id_fkey
      FOREIGN KEY (visual_style_id) REFERENCES visual_styles(id) ON DELETE SET NULL;
  END IF;
END$$;

-- 7. scripts
CREATE TABLE IF NOT EXISTS scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  synopsis TEXT,
  genre TEXT,
  characters JSONB DEFAULT '[]',
  relationships TEXT,
  worldview TEXT,
  plot_outline JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. episodes
CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  title TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, episode_number)
);

-- 9. scenes
CREATE TABLE IF NOT EXISTS scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  scene_number INT NOT NULL,
  location_name TEXT,
  time TEXT,
  weather TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scenes_episode_id ON scenes(episode_id);
CREATE INDEX IF NOT EXISTS idx_scenes_location_id ON scenes(location_id);

-- 10. shots
CREATE TABLE IF NOT EXISTS shots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  shot_number INT NOT NULL,
  description TEXT,
  character_ids JSONB DEFAULT '[]',
  action TEXT,
  emotion TEXT,
  environment TEXT,
  cinematography TEXT,
  dialogue TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shots_scene_id ON shots(scene_id);

-- 11. prompt_templates
CREATE TABLE IF NOT EXISTS prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  prompt_type TEXT NOT NULL CHECK (prompt_type IN ('image','video','voice','edit')),
  language TEXT NOT NULL CHECK (language IN ('zh','en')),
  system_rule TEXT NOT NULL,
  input_fields JSONB DEFAULT '[]',
  output_format TEXT,
  example TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, prompt_type, language)
);

-- 12. prompts
CREATE TABLE IF NOT EXISTS prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id UUID REFERENCES shots(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
  prompt_type TEXT NOT NULL CHECK (prompt_type IN ('image','video','voice','edit')),
  platform TEXT,
  language TEXT DEFAULT 'zh' CHECK (language IN ('zh','en')),
  context_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (shot_id IS NOT NULL AND episode_id IS NULL) OR
    (shot_id IS NULL AND episode_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_prompts_project_id ON prompts(project_id);
CREATE INDEX IF NOT EXISTS idx_prompts_shot_id ON prompts(shot_id);
CREATE INDEX IF NOT EXISTS idx_prompts_episode_id ON prompts(episode_id);
CREATE INDEX IF NOT EXISTS idx_prompts_shot_type_platform ON prompts(shot_id, prompt_type, platform, language);

-- 13. prompt_versions
CREATE TABLE IF NOT EXISTS prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version_number INT NOT NULL,
  is_current BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'ai' CHECK (source IN ('ai','manual')),
  ai_model TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(prompt_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_current ON prompt_versions(prompt_id) WHERE is_current = true;

-- 14. ai_generations (MVP 简化版)
CREATE TABLE IF NOT EXISTS ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT DEFAULT 'success' CHECK (status IN ('success','failed','timeout')),
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_generations_user_id ON ai_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_generations_project_id ON ai_generations(project_id);

-- ============================================
-- 触发器
-- ============================================

-- 新用户自动创建 profiles
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, nickname)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nickname', '匿名用户'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- updated_at 自动更新
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有业务表创建 updated_at 触发器
CREATE OR REPLACE FUNCTION create_updated_at_trigger(table_name TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS %I_updated_at ON %I; CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
    table_name, table_name, table_name, table_name
  );
END;
$$ LANGUAGE plpgsql;

SELECT create_updated_at_trigger('profiles');
SELECT create_updated_at_trigger('projects');
SELECT create_updated_at_trigger('stories');
SELECT create_updated_at_trigger('characters');
SELECT create_updated_at_trigger('locations');
SELECT create_updated_at_trigger('visual_styles');
SELECT create_updated_at_trigger('scripts');
SELECT create_updated_at_trigger('episodes');
SELECT create_updated_at_trigger('scenes');
SELECT create_updated_at_trigger('shots');

-- ============================================
-- RLS 权限
-- ============================================

-- 项目归属函数
CREATE OR REPLACE FUNCTION user_owns_project(project_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects WHERE id = project_uuid AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- scenes 归属函数
CREATE OR REPLACE FUNCTION scene_owns_project(scene_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM scenes s
    JOIN episodes e ON s.episode_id = e.id
    WHERE s.id = scene_uuid AND user_owns_project(e.project_id)
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 1. profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- 2. projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "projects_select_own" ON projects;
CREATE POLICY "projects_select_own" ON projects FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "projects_insert_own" ON projects;
CREATE POLICY "projects_insert_own" ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "projects_update_own" ON projects;
CREATE POLICY "projects_update_own" ON projects FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "projects_delete_own" ON projects;
CREATE POLICY "projects_delete_own" ON projects FOR DELETE USING (auth.uid() = user_id);

-- 3. stories
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stories_all_own" ON stories;
CREATE POLICY "stories_all_own" ON stories FOR ALL USING (user_owns_project(project_id)) WITH CHECK (user_owns_project(project_id));

-- 4. characters
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "characters_all_own" ON characters;
CREATE POLICY "characters_all_own" ON characters FOR ALL USING (user_owns_project(project_id)) WITH CHECK (user_owns_project(project_id));

-- 5. locations
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "locations_all_own" ON locations;
CREATE POLICY "locations_all_own" ON locations FOR ALL USING (user_owns_project(project_id)) WITH CHECK (user_owns_project(project_id));

-- 6. visual_styles
ALTER TABLE visual_styles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "visual_styles_all_own" ON visual_styles;
CREATE POLICY "visual_styles_all_own" ON visual_styles FOR ALL USING (user_owns_project(project_id)) WITH CHECK (user_owns_project(project_id));

-- 7. scripts
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scripts_all_own" ON scripts;
CREATE POLICY "scripts_all_own" ON scripts FOR ALL USING (user_owns_project(project_id)) WITH CHECK (user_owns_project(project_id));

-- 8. episodes
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "episodes_all_own" ON episodes;
CREATE POLICY "episodes_all_own" ON episodes FOR ALL USING (user_owns_project(project_id)) WITH CHECK (user_owns_project(project_id));

-- 9. scenes
ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scenes_all_own" ON scenes;
CREATE POLICY "scenes_all_own" ON scenes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = scenes.episode_id AND user_owns_project(e.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = scenes.episode_id AND user_owns_project(e.project_id)
    )
  );

-- 10. shots
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shots_all_own" ON shots;
CREATE POLICY "shots_all_own" ON shots
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM scenes s
      JOIN episodes e ON s.episode_id = e.id
      WHERE s.id = shots.scene_id AND user_owns_project(e.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM scenes s
      JOIN episodes e ON s.episode_id = e.id
      WHERE s.id = shots.scene_id AND user_owns_project(e.project_id)
    )
  );

-- 11. prompt_templates (所有人可读)
ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "templates_select_all" ON prompt_templates;
CREATE POLICY "templates_select_all" ON prompt_templates FOR SELECT USING (true);

-- 12. prompts
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prompts_all_own" ON prompts;
CREATE POLICY "prompts_all_own" ON prompts
  FOR ALL USING (
    (shot_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM shots sh
      JOIN scenes s ON sh.scene_id = s.id
      JOIN episodes e ON s.episode_id = e.id
      WHERE sh.id = prompts.shot_id AND user_owns_project(e.project_id)
    ))
    OR
    (episode_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = prompts.episode_id AND user_owns_project(e.project_id)
    ))
  );

-- 13. prompt_versions
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "versions_all_own" ON prompt_versions;
CREATE POLICY "versions_all_own" ON prompt_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM prompts p
      WHERE p.id = prompt_versions.prompt_id
      AND (
        (p.shot_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM shots sh
          JOIN scenes s ON sh.scene_id = s.id
          JOIN episodes e ON s.episode_id = e.id
          WHERE sh.id = p.shot_id AND user_owns_project(e.project_id)
        ))
        OR
        (p.episode_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM episodes e
          WHERE e.id = p.episode_id AND user_owns_project(e.project_id)
        ))
      )
    )
  );

-- 14. ai_generations
ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_generations_all_own" ON ai_generations;
CREATE POLICY "ai_generations_all_own" ON ai_generations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 预置 Prompt 模板
-- ============================================

INSERT INTO prompt_templates (platform, prompt_type, language, system_rule, output_format, example) VALUES
('jimeng', 'image', 'zh', '你是即梦AI图片Prompt生成专家。根据角色、场景、风格和镜头信息，生成一段中文图片生成Prompt。要求：1.角色描述使用fixed_prompt原文 2.场景描述使用fixed_prompt原文 3.风格描述使用fixed_prompt原文 4.镜头动态描述补充 5.输出为纯文本，不要分段，用逗号连接', '纯文本逗号分隔', '25岁亚洲女性，黑色长直发，清冷五官，身穿白色婚纱，现代医院入口，深夜暴雨，霓虹灯倒影，冷蓝灰色调，电影摄影，中景构图，低角度仰拍，16:9'),
('midjourney', 'image', 'en', 'You are a Midjourney prompt expert. Based on character, location, visual style and shot info, generate an English image prompt. Rules: 1. Use character fixed_prompt verbatim 2. Use location fixed_prompt verbatim 3. Use style fixed_prompt verbatim 4. Add shot dynamics 5. Output as comma-separated text, add --ar 16:9 at end', 'comma-separated text ending with --ar 16:9', '25yo Asian female, black long straight hair, cold facial features, white wedding dress, modern hospital entrance, midnight rain, neon reflections, cold blue-grey tones, cinematic photography, medium shot, low angle, shallow depth of field --ar 16:9'),
('flux', 'image', 'en', 'You are a Flux image prompt expert. Generate a detailed English image prompt based on the provided character, location, visual style and shot information. Use fixed_prompt values verbatim. Output as a flowing paragraph.', 'flowing paragraph', 'A 25-year-old Asian woman with long straight black hair and cold features, wearing a white wedding dress, standing at a modern hospital entrance in midnight rain with neon reflections, cold blue-grey tones, cinematic photography, medium shot from low angle.'),
('comfyui', 'image', 'zh', '你是ComfyUI Prompt生成专家。根据角色、场景、风格和镜头信息生成中文ComfyUI风格的Prompt。使用fixed_prompt原文，输出为逗号分隔的标签格式。', '逗号分隔标签', '25岁亚洲女性, 黑色长直发, 清冷五官, 白色婚纱, 现代医院入口, 深夜暴雨, 霓虹灯倒影, 冷蓝灰色调, 电影摄影, 中景构图, 低角度仰拍'),
('kling', 'video', 'zh', '你是可灵AI视频Prompt生成专家。根据镜头信息、角色和场景，生成中文视频运动描述Prompt。重点描述：1.镜头运动（推/拉/摇/移） 2.人物动作 3.环境变化 4.情绪表达', '纯文本段落', '镜头缓慢推进，25岁亚洲女性身穿被雨水打湿的白色婚纱，表情绝望而不甘，眼神坚定地抬头望向医院温暖的灯光，雨水从婚纱上滴落，远处救护车灯光闪烁'),
('runway', 'video', 'en', 'You are a Runway video prompt expert. Generate an English video motion description based on shot info, character and location. Focus on: 1. Camera movement (push/pull/pan/tilt) 2. Character action 3. Environment change 4. Emotion expression', 'text paragraph', 'Camera slowly pushes in, a 25-year-old Asian woman in a rain-soaked white wedding dress looks up at the warm hospital lights with a desperate yet determined expression, raindrops fall from the dress, ambulance lights flash in the distance'),
('ltx', 'video', 'zh', '你是LTX视频Prompt生成专家。根据镜头信息生成中文视频Prompt，描述镜头运动和场景动态。使用角色和场景的fixed_prompt确保一致性。', '纯文本段落', '低角度仰拍，镜头缓缓上移，25岁亚洲女性黑色长直发被风吹起，身穿被雨水打湿的白色婚纱，站在现代医院入口前，霓虹灯在水洼中倒影闪烁，冷蓝灰色调')
ON CONFLICT (platform, prompt_type, language) DO NOTHING;

-- ============================================
-- 完成
-- ============================================
