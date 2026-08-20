// ============================================
// AI Action - 资产 AI 优化（角色 / 场景 / 风格）
// 对照原型 03-assets.html：卡片内「✨ AI 优化 → 生成优化版本」
// 按用户提示词优化资产全部设定字段，fixed_prompt 输出英文并写入版本链
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import { getRenderedSystemPrompt } from "@/lib/ai/node-template-loader";
import * as AssetVersions from "@/lib/models/asset-versions";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OptimizeEntityType = "character" | "location" | "visual_style";

/** DI 上下文 */
export interface AssetOptimizeDI {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 各实体的表名 */
const TABLES: Record<OptimizeEntityType, "characters" | "locations" | "visual_styles"> = {
  character: "characters",
  location: "locations",
  visual_style: "visual_styles",
};

/** entityType → 节点 key（system prompt 正文在 node-registry: asset_optimize_* 三节点） */
const NODE_KEYS: Record<OptimizeEntityType, string> = {
  character: "asset_optimize_character",
  location: "asset_optimize_location",
  visual_style: "asset_optimize_style",
};

/** 各实体的当前信息查询字段 + 项目上下文 */
async function loadEntity(
  supabase: SupabaseClient,
  entityType: OptimizeEntityType,
  entityId: string
) {
  const table = TABLES[entityType];
  const { data: entity, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !entity) throw new Error("资产不存在");

  const { data: project } = await supabase
    .from("projects")
    .select("name, synopsis")
    .eq("id", entity.project_id)
    .maybeSingle();

  return { entity, project };
}

/**
 * AI 优化资产（角色 / 场景 / 风格）
 * @returns 更新后的资产行 + 新版本号
 */
export async function optimizeAsset(
  params: {
    entityType: OptimizeEntityType;
    entityId: string;
    userId: string;
    prompt: string;
  },
  ctx?: AssetOptimizeDI
) {
  const { entityType, entityId, userId, prompt } = params;
  if (!prompt.trim()) throw new Error("优化提示词不能为空");

  const supabase = ctx?.supabase ?? (await getDefaultClient());
  const { entity, project } = await loadEntity(supabase, entityType, entityId);

  // 构建 AI 消息：项目上下文 + 当前资产设定 + 用户优化要求
  const userContent = `【项目背景】${project?.name ?? ""}：${project?.synopsis ?? ""}

【当前${entityType === "visual_style" ? "风格设定" : "资产设定"}】
${JSON.stringify(entity, null, 2)}

【优化要求】
${prompt.trim()}

请输出优化后的完整 JSON。`;

  // 加载节点模板（三分支对应 asset_optimize_* 三节点，走统一配置化链路）
  const optimizeSystemPrompt = await getRenderedSystemPrompt(
    supabase, userId, entity.project_id, NODE_KEYS[entityType]
  );
  const messages: ChatMessage[] = [
    { role: "system", content: optimizeSystemPrompt },
    { role: "user", content: userContent },
  ];

  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const result = await AIService.generate(
    messages,
    { temperature: 0.5, jsonMode: true, ...aiConfig },
    { userId, projectId: entity.project_id, type: "chat" as never },
    ctx
  );

  const parsed = result.json as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 返回的优化结果格式不正确");
  }

  // 允许更新的字段白名单
  const FIELD_WHITELIST: Record<OptimizeEntityType, string[]> = {
    character: ["name", "role", "age", "gender", "appearance", "personality", "background", "clothing", "fixed_prompt"],
    location: ["name", "description", "environment", "time", "weather", "color_style", "fixed_prompt"],
    visual_style: ["name", "color", "cinematography", "fixed_prompt", "negative_prompt"],
  };

  const updateData: Record<string, unknown> = {};
  for (const key of FIELD_WHITELIST[entityType]) {
    const value = parsed[key];
    if (value === undefined || value === null) continue;
    if (key === "age") {
      const age = Number(value);
      if (!Number.isNaN(age)) updateData.age = age;
      continue;
    }
    if (typeof value === "string" && value.trim()) updateData[key] = value.trim();
  }

  if (!updateData.fixed_prompt) {
    throw new Error("AI 未返回有效的 fixed_prompt，请重试");
  }

  // 更新资产
  const { data: updated, error: updateError } = await supabase
    .from(TABLES[entityType])
    .update(updateData)
    .eq("id", entityId)
    .select("*")
    .single();
  if (updateError) throw new Error(`更新失败: ${updateError.message}`);

  // 写入 fixed_prompt 版本链（source: ai_optimize）
  const version = await AssetVersions.createVersion(
    {
      entity_type: entityType,
      entity_id: entityId,
      project_id: entity.project_id,
      content: String(updateData.fixed_prompt),
      source: "ai_optimize",
      ai_model: aiConfig.model ?? undefined,
      metadata: { prompt: prompt.trim() },
    },
    { supabase }
  );

  return { data: updated, version: version.version_number };
}
