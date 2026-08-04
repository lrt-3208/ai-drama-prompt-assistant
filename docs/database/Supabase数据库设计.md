# Supabase 数据库设计

> 全部 14 张表的完整建表 SQL。  
> 关联文档：[数据关系设计.md](./数据关系设计.md) | [RLS权限设计.md](./RLS权限设计.md)

---

## 表总览

```
profiles              用户扩展
projects              短剧项目
stories               故事输入
characters            角色资产
locations             场景资产
visual_styles         视觉风格资产
scripts               剧本
episodes              剧集
scenes                场景
shots                 镜头
prompt_templates      Prompt 平台模板
prompts               Prompt 逻辑记录
prompt_versions       Prompt 物理版本
ai_generations        AI 调用日志（扩展预留）
```

---

## 1. profiles

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT,
  avatar_url TEXT,
  preferred_ai_model TEXT DEFAULT 'deepseek',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 2. projects

```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  synopsis TEXT,
  genre TEXT,
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft','scripting','asset_building','storyboarding','prompting','completed','deleted')),
  visual_style_id UUID REFERENCES visual_styles(id) ON DELETE SET NULL,
  cover_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_projects_user_id ON projects(user_id);
```

## 3. stories

> **Story = 用户原始创意**（未经 AI 加工）。Script = AI 加工后的结构化剧本。

```sql
-- Story：用户原始创意输入
-- 区别于 scripts 表（AI 加工后的结构化剧本）
CREATE TABLE stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_input TEXT NOT NULL,          -- 原始创意文本
  input_mode TEXT DEFAULT 'story' CHECK (input_mode IN ('story','paste')),
  theme TEXT,                        -- 主题（如"重生复仇豪门"）
  genre TEXT,                        -- 类型（如"都市/悬疑/古风"）
  core_conflict TEXT,                -- 核心冲突
  target_emotion TEXT,               -- 目标情绪
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 4. characters

```sql
-- 冻结版字段：name/age/gender/appearance/personality/background/clothing/fixed_prompt
CREATE TABLE characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INT,
  gender TEXT CHECK (gender IN ('男','女')),
  appearance TEXT,           -- 外貌描述
  personality TEXT,          -- 性格
  background TEXT,           -- 背景
  clothing TEXT,             -- 服装
  fixed_prompt TEXT NOT NULL,-- 固定视觉描述 Prompt（核心字段，一致性锁定）
  reference_image_url TEXT,  -- 参考图（扩展预留）
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_characters_project_id ON characters(project_id);
```

## 5. locations

```sql
-- 冻结版字段：name/description/environment/time/weather/color_style/fixed_prompt
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,           -- 场景描述
  environment TEXT,           -- 环境描述
  time TEXT,                  -- 时间
  weather TEXT,               -- 天气
  color_style TEXT,           -- 色调
  fixed_prompt TEXT NOT NULL, -- 固定场景描述 Prompt（核心字段，一致性锁定）
  reference_image_url TEXT,   -- 参考图（扩展预留）
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_locations_project_id ON locations(project_id);
```

## 6. visual_styles

```sql
-- 冻结版字段：name/camera_style/color/lighting/cinematography/fixed_prompt
CREATE TABLE visual_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  camera_style TEXT,          -- 摄影风格
  color TEXT,                 -- 色彩方案
  lighting TEXT,              -- 光影
  cinematography TEXT,        -- 镜头语言
  fixed_prompt TEXT NOT NULL, -- 固定风格 Prompt（核心字段，一致性锁定）
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 7. scripts

> **Script = AI 加工后的结构化剧本**（人物/剧情/章节/对白）。Story 是用户原始创意。

```sql
-- Script：AI 加工后的结构化剧本
-- 输入 = Story（原始创意），输出 = 结构化剧本
CREATE TABLE scripts (
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
```

## 8. episodes

```sql
CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  title TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, episode_number)
);
```

## 9. scenes

```sql
CREATE TABLE scenes (
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
CREATE INDEX idx_scenes_episode_id ON scenes(episode_id);
CREATE INDEX idx_scenes_location_id ON scenes(location_id);
```

## 10. shots

```sql
CREATE TABLE shots (
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
CREATE INDEX idx_shots_scene_id ON shots(scene_id);
```

## 11. prompt_templates

```sql
CREATE TABLE prompt_templates (
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
```

## 12. prompts

```sql
-- 冻结版：新增 project_id + context_snapshot
-- context_snapshot 保存生成 Prompt 时使用的角色/场景/风格版本快照
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id UUID REFERENCES shots(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
  prompt_type TEXT NOT NULL CHECK (prompt_type IN ('image','video','voice','edit')),
  platform TEXT,
  language TEXT DEFAULT 'zh' CHECK (language IN ('zh','en')),
  context_snapshot JSONB,    -- 生成时的上下文快照（角色/场景/风格版本）
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (shot_id IS NOT NULL AND episode_id IS NULL) OR
    (shot_id IS NULL AND episode_id IS NOT NULL)
  )
);
CREATE INDEX idx_prompts_project_id ON prompts(project_id);
CREATE INDEX idx_prompts_shot_id ON prompts(shot_id);
CREATE INDEX idx_prompts_episode_id ON prompts(episode_id);
CREATE INDEX idx_prompts_shot_type_platform ON prompts(shot_id, prompt_type, platform, language);
```

### context_snapshot 结构示例

```json
{
  "characters": [
    { "id": "uuid", "name": "林晚", "fixed_prompt": "25岁亚洲女性，黑色长直发，清冷五官..." }
  ],
  "location": { "id": "uuid", "name": "医院门口", "fixed_prompt": "现代医院入口，深夜暴雨..." },
  "visual_style": { "id": "uuid", "name": "都市复仇", "fixed_prompt": "冷蓝灰色调，电影摄影..." }
}
```

> **用途**：未来修改角色/场景/风格后，可追溯历史 Prompt 使用了哪个版本的描述，支持恢复历史生成环境。

## 13. prompt_versions

```sql
CREATE TABLE prompt_versions (
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
CREATE INDEX idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
CREATE INDEX idx_prompt_versions_current ON prompt_versions(prompt_id) WHERE is_current = true;
```

## 14. ai_generations（MVP 简化日志）

> **MVP 只做简单日志，不做计费体系。** 仅记录调用结果，方便排查问题。

```sql
-- MVP 简化版：只记录核心调用日志
CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  type TEXT NOT NULL,              -- 调用类型：script / storyboard / characters / image_prompt / video_prompt
  model TEXT NOT NULL,            -- 使用的模型名
  status TEXT DEFAULT 'success' CHECK (status IN ('success','failed','timeout')),
  error_message TEXT,             -- 失败时的错误信息
  retry_count INT DEFAULT 0,      -- 重试次数
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ai_generations_user_id ON ai_generations(user_id);
CREATE INDEX idx_ai_generations_project_id ON ai_generations(project_id);
```

> V2 扩展时可加 input_summary / output_tokens / prompt_tokens / duration_ms 等字段用于用量统计和计费。

---

## 触发器

```sql
-- 新用户自动创建 profiles
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, nickname)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nickname', '匿名用户'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER stories_updated_at BEFORE UPDATE ON stories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER characters_updated_at BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER locations_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER visual_styles_updated_at BEFORE UPDATE ON visual_styles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER scripts_updated_at BEFORE UPDATE ON scripts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER episodes_updated_at BEFORE UPDATE ON episodes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER scenes_updated_at BEFORE UPDATE ON scenes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER shots_updated_at BEFORE UPDATE ON shots FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 默认数据（prompt_templates 预置）

见 [平台适配模板](../prompt/平台适配模板.md#默认模板数据) 的 13 条模板记录 SQL。
