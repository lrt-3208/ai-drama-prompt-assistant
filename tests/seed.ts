/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 短剧测试数据种子脚本
 *
 * 用法：
 *   1. 确保 .env.local 中有 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 和 SUPABASE_SERVICE_ROLE_KEY
 *   2. 运行: npx tsx tests/seed.ts
 *   3. 或指定用户ID: npx tsx tests/seed.ts --user=48af9ad4-4e73-4bf4-b267-77c2d5d6a993
 *
 * 会创建 5 个短剧项目，每个包含：角色、场景、视觉风格、剧本
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

// ---------- 配置 ----------
const FIXTURES_DIR = join(process.cwd(), "tests", "fixtures");

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function loadFixture<T>(name: string): T {
  const path = join(FIXTURES_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

// ---------- 主流程 ----------
async function main() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("缺少环境变量 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  // 获取用户ID（从命令行参数或数据库查询）
  const userArg = process.argv.find((a) => a.startsWith("--user="));
  let userId: string;

  if (userArg) {
    userId = userArg.split("=")[1];
  } else {
    // 从 projects 表获取第一个用户
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data } = await supabase.from("projects").select("user_id").limit(1);
    if (!data || data.length === 0) {
      console.error("数据库中无项目，无法推断 user_id。请用 --user=参数 指定。");
      process.exit(1);
    }
    userId = data[0].user_id;
  }

  console.log(`使用 user_id: ${userId}`);
  console.log(`Supabase URL: ${supabaseUrl}`);

  const supabase = createClient(supabaseUrl, serviceKey);

  // 清理旧测试数据
  console.log("\n清理旧测试数据...");
  const { data: oldProjects } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .like("name", "%[测试]%");

  if (oldProjects && oldProjects.length > 0) {
    const oldIds = oldProjects.map((p) => p.id);
    await supabase.from("projects").delete().in("id", oldIds);
    console.log(`  清理了 ${oldIds.length} 个旧测试项目`);
  }

  // 加载测试数据
  const projects = loadFixture<any[]>("projects");
  const charactersData = loadFixture<any[]>("characters");
  const locationsData = loadFixture<any[]>("locations");
  const visualStyles = loadFixture<any[]>("visual-styles");
  const scripts = loadFixture<any[]>("scripts");

  const projectIdMap = new Map<string, string>(); // proj-001 → real UUID

  // 1. 创建项目
  console.log("\n创建项目...");
  for (const proj of projects) {
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name: `${proj.name} [测试]`,
        synopsis: proj.synopsis,
        genre: proj.genre,
        status: "draft",
        asset_status: "draft",
        generation_config: proj.generation_config || null,
      })
      .select("id, name")
      .single();

    if (error) {
      console.error(`  失败: ${proj.name} - ${error.message}`);
      continue;
    }

    projectIdMap.set(proj.id, data.id);
    console.log(`  ✓ ${data.name} → ${data.id}`);

    // 同步创建 story
    await supabase.from("stories").insert({
      project_id: data.id,
      raw_input: proj.synopsis,
      input_mode: "story",
      genre: proj.genre,
    });
  }

  // 2. 创建角色
  console.log("\n创建角色...");
  for (const item of charactersData) {
    const projectId = projectIdMap.get(item.projectId);
    if (!projectId) continue;

    for (const char of item.characters) {
      const { error } = await supabase.from("characters").insert({
        project_id: projectId,
        name: char.name,
        age: char.age,
        gender: char.gender,
        appearance: char.appearance,
        personality: char.personality,
        background: char.background,
        clothing: char.clothing,
        fixed_prompt: char.fixed_prompt,
        visual_description: char.visual_description,
      });

      if (error) {
        console.error(`  失败: ${char.name} - ${error.message}`);
      } else {
        console.log(`  ✓ [${item.projectId}] ${char.name}`);
      }
    }
  }

  // 3. 创建场景
  console.log("\n创建场景...");
  for (const item of locationsData) {
    const projectId = projectIdMap.get(item.projectId);
    if (!projectId) continue;

    for (const loc of item.locations) {
      const { error } = await supabase.from("locations").insert({
        project_id: projectId,
        name: loc.name,
        description: loc.description,
        environment: loc.environment,
        time: loc.time,
        weather: loc.weather,
        color_style: loc.color_style,
        fixed_prompt: loc.fixed_prompt,
        visual_description: loc.visual_description,
      });

      if (error) {
        console.error(`  失败: ${loc.name} - ${error.message}`);
      } else {
        console.log(`  ✓ [${item.projectId}] ${loc.name}`);
      }
    }
  }

  // 4. 创建视觉风格
  console.log("\n创建视觉风格...");
  for (const vs of visualStyles) {
    const projectId = projectIdMap.get(vs.projectId);
    if (!projectId) continue;

    const { data: vsRec, error } = await supabase.from("visual_styles").insert({
      project_id: projectId,
      name: vs.name,
      camera_style: vs.camera_style,
      color: vs.color,
      lighting: vs.lighting,
      cinematography: vs.cinematography,
      fixed_prompt: vs.fixed_prompt,
    }).select("id").single();

    if (error) {
      console.error(`  失败: ${vs.name} - ${error.message}`);
    } else {
      // 回写 projects.visual_style_id（与 POST /api/projects/[id]/style 行为一致，
      // 场景视频 Prompt 生成通过该外键关联查询视觉风格）
      await supabase.from("projects").update({ visual_style_id: vsRec.id }).eq("id", projectId);
      console.log(`  ✓ [${vs.projectId}] ${vs.name}`);
    }
  }

  // 5. 创建剧本
  console.log("\n创建剧本...");
  for (const script of scripts) {
    const projectId = projectIdMap.get(script.projectId);
    if (!projectId) continue;

    const { error } = await supabase.from("scripts").insert({
      project_id: projectId,
      synopsis: script.synopsis,
      genre: script.genre,
      characters: script.characters,
      relationships: script.relationships,
      worldview: script.worldview,
      plot_outline: script.plot_outline,
    });

    if (error) {
      console.error(`  失败: [${script.projectId}] - ${error.message}`);
    } else {
      console.log(`  ✓ [${script.projectId}] 剧本已创建`);
    }
  }

  // 汇总
  console.log("\n========================================");
  console.log("测试数据导入完成！");
  console.log("========================================");
  console.log(`项目数: ${projects.length}`);
  console.log(`角色总数: ${charactersData.reduce((s, d) => s + d.characters.length, 0)}`);
  console.log(`场景总数: ${locationsData.reduce((s, d) => s + d.locations.length, 0)}`);
  console.log(`视觉风格: ${visualStyles.length}`);
  console.log(`剧本: ${scripts.length}`);
  console.log("\n项目映射 (fixture ID → 数据库 UUID):");
  for (const [fid, uuid] of projectIdMap) {
    console.log(`  ${fid} → ${uuid}`);
  }
  console.log("\n可前往 http://localhost:8888/dashboard 查看测试项目。");
}

main().catch((err) => {
  console.error("种子脚本执行失败:", err);
  process.exit(1);
});
