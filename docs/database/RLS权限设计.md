# RLS 权限设计

> 行级安全策略（Row Level Security）完整设计。  
> 关联文档：[Supabase数据库设计.md](./Supabase数据库设计.md)

---

## 设计原则

- 所有业务表启用 RLS
- 用户只能访问自己的数据（通过 `auth.uid()` 验证）
- 通过项目归属函数实现级联权限（子表通过 project_id 判断归属）

---

## 项目归属函数

```sql
CREATE OR REPLACE FUNCTION user_owns_project(project_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects WHERE id = project_uuid AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER;
```

---

## 1. profiles

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id);
```

## 2. projects

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select_own" ON projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "projects_insert_own" ON projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "projects_update_own" ON projects
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "projects_delete_own" ON projects
  FOR DELETE USING (auth.uid() = user_id);
```

## 3. stories

```sql
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stories_all_own" ON stories
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));
```

## 4. characters

```sql
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "characters_all_own" ON characters
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));
```

## 5. locations

```sql
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations_all_own" ON locations
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));
```

## 6. visual_styles

```sql
ALTER TABLE visual_styles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visual_styles_all_own" ON visual_styles
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));
```

## 7. scripts

```sql
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scripts_all_own" ON scripts
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));
```

## 8. episodes

```sql
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "episodes_all_own" ON episodes
  FOR ALL USING (user_owns_project(project_id))
  WITH CHECK (user_owns_project(project_id));
```

## 9. scenes

scenes 需要通过 episode → project 两级查询归属：

```sql
ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION scene_owns_project(scene_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM scenes s
    JOIN episodes e ON s.episode_id = e.id
    WHERE s.id = scene_uuid AND user_owns_project(e.project_id)
  );
$$ LANGUAGE sql SECURITY DEFINER;

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
```

## 10. shots

```sql
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;

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
```

## 11. prompt_templates

prompt_templates 是全局模板表，所有用户可读，仅管理员可写：

```sql
ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_select_all" ON prompt_templates
  FOR SELECT USING (true);
-- 写入策略：通过 Supabase Dashboard / service_role 管理，不开放给普通用户
```

## 12. prompts

prompts 通过 shot_id 或 episode_id 关联，需检查两者归属：

```sql
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompts_all_own" ON prompts
  FOR ALL USING (
    -- shot 级 Prompt：通过 shot → scene → episode → project 验证
    (shot_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM shots sh
      JOIN scenes s ON sh.scene_id = s.id
      JOIN episodes e ON s.episode_id = e.id
      WHERE sh.id = prompts.shot_id AND user_owns_project(e.project_id)
    ))
    OR
    -- 集级 Prompt：通过 episode → project 验证
    (episode_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = prompts.episode_id AND user_owns_project(e.project_id)
    ))
  );
```

## 13. prompt_versions

```sql
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

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
```

## 14. ai_generations

```sql
ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_generations_all_own" ON ai_generations
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

---

## 策略总结

| 表 | SELECT | INSERT | UPDATE | DELETE |
|----|--------|--------|--------|--------|
| profiles | 自己 | 自己 | 自己 | — |
| projects | 自己 | 自己 | 自己 | 自己 |
| stories | 项目归属 | 项目归属 | 项目归属 | 项目归属 |
| characters | 项目归属 | 项目归属 | 项目归属 | 项目归属 |
| locations | 项目归属 | 项目归属 | 项目归属 | 项目归属 |
| visual_styles | 项目归属 | 项目归属 | 项目归属 | 项目归属 |
| scripts | 项目归属 | 项目归属 | 项目归属 | 项目归属 |
| episodes | 项目归属 | 项目归属 | 项目归属 | 项目归属 |
| scenes | 归属(2级) | 归属(2级) | 归属(2级) | 归属(2级) |
| shots | 归属(3级) | 归属(3级) | 归属(3级) | 归属(3级) |
| prompt_templates | 所有人 | — | — | — |
| prompts | 归属(4级) | 归属(4级) | 归属(4级) | 归属(4级) |
| prompt_versions | 归属(5级) | 归属(5级) | 归属(5级) | 归属(5级) |
| ai_generations | 自己 | 自己 | 自己 | 自己 |
