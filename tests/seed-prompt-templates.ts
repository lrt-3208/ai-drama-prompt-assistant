/**
 * LLM 提示词模板系统默认 Seed 脚本
 *
 * 用法：
 *   1. 先在 Supabase Dashboard 手动执行 supabase/migration_v32.sql
 *   2. 运行: npx tsx tests/seed-prompt-templates.ts
 *
 * 从 lib/ai/node-registry.ts（单一事实源）导入 15 个节点的默认模板，
 * 写入 llm_prompt_templates 系统默认行（user_id IS NULL, serialization_mode IS NULL）。
 * 幂等：已存在的系统行会更新 system_rule 并保持 version_number=1（重跑同步代码侧文案修订）。
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";
import { NODE_REGISTRY, NODE_KEYS } from "../lib/ai/node-registry";

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

async function main() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("缺少环境变量 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 检查表是否存在（migration 是否已执行）
  const { error: probeError } = await supabase
    .from("llm_prompt_templates")
    .select("id", { count: "exact", head: true });
  if (probeError) {
    console.error("llm_prompt_templates 表不可用，请先在 Supabase Dashboard 执行 migration_v32.sql");
    console.error(`详情: ${probeError.message}`);
    process.exit(1);
  }

  let inserted = 0;
  let updated = 0;

  for (const key of NODE_KEYS) {
    const def = NODE_REGISTRY[key];

    const { data: existing } = await supabase
      .from("llm_prompt_templates")
      .select("id, system_rule")
      .is("user_id", null)
      .eq("node_key", key)
      .is("serialization_mode", null)
      .maybeSingle();

    if (existing) {
      if (existing.system_rule !== def.defaultSystemRule) {
        const { error } = await supabase
          .from("llm_prompt_templates")
          .update({ system_rule: def.defaultSystemRule })
          .eq("id", existing.id);
        if (error) {
          console.error(`✗ 更新 ${key} 失败: ${error.message}`);
          process.exit(1);
        }
        updated++;
      }
    } else {
      const { error } = await supabase.from("llm_prompt_templates").insert({
        user_id: null,
        node_key: key,
        serialization_mode: null,
        system_rule: def.defaultSystemRule,
        version_number: 1,
        is_current: true,
        source: "system",
      });
      if (error) {
        console.error(`✗ 插入 ${key} 失败: ${error.message}`);
        process.exit(1);
      }
      inserted++;
    }
  }

  console.log(`完成：新插入 ${inserted} 行，更新 ${updated} 行（共 ${NODE_KEYS.length} 个节点）`);

  // 验证
  const { count } = await supabase
    .from("llm_prompt_templates")
    .select("id", { count: "exact", head: true })
    .is("user_id", null);
  console.log(`系统默认行总数: ${count ?? 0}（预期 ${NODE_KEYS.length}）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
