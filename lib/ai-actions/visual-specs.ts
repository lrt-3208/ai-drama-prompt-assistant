// ============================================
// AI Action - 角色视觉规范生成
// 4 类轻量设计：appearance / expression / costume / camera_reference
// 按需触发：手动按钮 / 首次生成图片 Prompt 时发现无 visual_specs
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import { getRenderedSystemPrompt } from "@/lib/ai/node-template-loader";
import type { SupabaseClient } from "@supabase/supabase-js";

/** DI 上下文 */
export interface VisualSpecsDI {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 视觉规范类型 */
export const SPEC_TYPES = ["appearance", "expression", "costume", "camera_reference"] as const;
export type SpecType = (typeof SPEC_TYPES)[number];

export interface VisualSpec {
  spec_type: SpecType;
  spec_name: string;
  spec_prompt: string;
}

/**
 * 为角色生成视觉规范（4 类）
 * @param characterId 角色 ID
 * @param userId 用户 ID（用于获取 AI 模型配置）
 */
export async function generateVisualSpecs(
  characterId: string,
  userId: string,
  ctx?: VisualSpecsDI
): Promise<VisualSpec[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 查询角色信息
  const { data: character, error: charError } = await supabase
    .from("characters")
    .select("id, name, appearance, clothing, fixed_prompt, project_id")
    .eq("id", characterId)
    .maybeSingle();

  if (charError || !character) {
    throw new Error("角色不存在");
  }

  // 2. 构建 AI 消息
  const userContent = `请为以下角色生成视觉规范：

角色名称：${character.name}
外貌：${character.appearance || "未指定"}
服装：${character.clothing || "未指定"}
fixed_prompt：${character.fixed_prompt || "未指定"}`;

  // 加载节点模板（正文在 node-registry: visual_specs）
  const specsSystemPrompt = await getRenderedSystemPrompt(
    supabase, userId, character.project_id, "visual_specs"
  );
  const messages: ChatMessage[] = [
    { role: "system", content: specsSystemPrompt },
    { role: "user", content: userContent },
  ];

  // 3. 调用 AI 生成
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const result = await AIService.generate(
    messages,
    {
      temperature: 0.4,
      jsonMode: true,
      ...aiConfig,
    },
    { userId, projectId: character.project_id, type: "chat" as never },
    ctx
  );

  const parsed = (result.json || {}) as {
    specs?: Array<{ spec_type: string; spec_name: string; spec_prompt: string }>;
  };

  if (!parsed.specs || !Array.isArray(parsed.specs)) {
    throw new Error("AI 返回的视觉规范格式不正确");
  }

  // 4. 写入 character_visual_specs（upsert）
  const validSpecs: VisualSpec[] = [];
  let sortOrder = 0;

  for (const spec of parsed.specs) {
    if (!SPEC_TYPES.includes(spec.spec_type as SpecType)) continue;

    const specType = spec.spec_type as SpecType;
    validSpecs.push({
      spec_type: specType,
      spec_name: spec.spec_name || specType,
      spec_prompt: spec.spec_prompt,
    });

    // upsert（UNIQUE(character_id, spec_type) 约束）
    await supabase
      .from("character_visual_specs")
      .upsert(
        {
          character_id: characterId,
          project_id: character.project_id,
          spec_type: specType,
          spec_name: spec.spec_name || specType,
          spec_prompt: spec.spec_prompt,
          sort_order: sortOrder++,
        },
        { onConflict: "character_id,spec_type" }
      );
  }

  return validSpecs;
}

/**
 * 查询角色的视觉规范
 */
export async function getVisualSpecs(
  characterId: string,
  ctx?: VisualSpecsDI
): Promise<VisualSpec[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { data, error } = await supabase
    .from("character_visual_specs")
    .select("spec_type, spec_name, spec_prompt")
    .eq("character_id", characterId)
    .order("sort_order", { ascending: true });

  if (error || !data) return [];
  return data as VisualSpec[];
}

/**
 * 检查角色是否有视觉规范
 */
export async function hasVisualSpecs(
  characterId: string,
  ctx?: VisualSpecsDI
): Promise<boolean> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const { count } = await supabase
    .from("character_visual_specs")
    .select("id", { count: "exact", head: true })
    .eq("character_id", characterId);

  return (count || 0) > 0;
}
