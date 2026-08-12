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

const VISUAL_SPECS_SYSTEM_PROMPT = `你是一位专业的 AI 角色视觉设计师。请根据角色信息，生成 4 类视觉规范，每类一条 Prompt。

【4 类规范】
1. appearance（外貌）：角色的面部特征、发型、体型等外貌描述。必须包含 "standing pose" 和 "full body" 姿态关键词。
2. expression（表情）：角色的典型表情和情绪表现。必须包含 "facing camera" 正面朝向关键词。
3. costume（服装）：角色的服装风格和配饰。
4. camera_reference（摄影参考）：推荐的角度、构图和光影参考。必须包含 "clean white background" 和 "studio lighting" 关键词，禁止包含任何场景或环境元素。

【定妆照约束 — 适用于所有规范】
- 姿态：必须为站立姿态（standing pose），禁止坐、蹲、跑、跳等动态姿势
- 背景：必须为纯净背景（clean white background / solid color background），禁止任何场景、环境、道具元素
- 光照：推荐影棚光照（studio lighting, even lighting）
- 构图：全身或半身正面肖像（full body portrait, facing camera）

【要求】
- 每条 Prompt 应包含足够细节，可直接用于 AI 图片生成
- 使用英文输出（兼容主流 AI 图片模型）
- 每条 Prompt 应包含足够细节以确保 AI 图片生成质量，不设字数上限

请以 JSON 格式输出，不要输出任何其他内容：
{
  "specs": [
    { "spec_type": "appearance", "spec_name": "角色外貌", "spec_prompt": "..." },
    { "spec_type": "expression", "spec_name": "角色表情", "spec_prompt": "..." },
    { "spec_type": "costume", "spec_name": "角色服装", "spec_prompt": "..." },
    { "spec_type": "camera_reference", "spec_name": "摄影参考", "spec_prompt": "..." }
  ]
}`;

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

  const messages: ChatMessage[] = [
    { role: "system", content: VISUAL_SPECS_SYSTEM_PROMPT },
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
