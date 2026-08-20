// ============================================
// Prompt Engine - Prompt 质量评分器
// AI 评估 Prompt 质量 4 维度，输出 1-5 分 + 评语
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import { getRenderedSystemPrompt } from "@/lib/ai/node-template-loader";
import type { SupabaseClient } from "@supabase/supabase-js";

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export interface PromptQualityResult {
  score: number; // 1-5
  note: string;
  dimensions: {
    clarity: number; // 清晰度
    specificity: number; // 具体性
    consistency: number; // 一致性
    completeness: number; // 完整性
  };
}

/**
 * 评估 Prompt 质量
 * @param promptId Prompt ID
 * @param userId 用户 ID（用于获取 AI 模型配置）
 */
export async function evaluatePromptQuality(
  promptId: string,
  userId: string,
  ctx?: { supabase?: SupabaseClient }
): Promise<PromptQualityResult> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 获取当前版本内容
  const { data: version, error: versionError } = await supabase
    .from("prompt_versions")
    .select("content, negative_prompt")
    .eq("prompt_id", promptId)
    .eq("is_current", true)
    .maybeSingle();

  if (versionError || !version) {
    throw new Error("找不到当前 Prompt 版本");
  }

  // 2. 构建 AI 消息
  const userContent = `请评估以下 Prompt：

【正面 Prompt】
${version.content}

${version.negative_prompt ? `【负面 Prompt】\n${version.negative_prompt}` : ""}`;

  // 加载节点模板（正文在 node-registry: evaluate_prompt；该节点无项目上下文，projectId 传空串，
  // 模板不引用 &变量，loader 内部项目查不到时变量按空值兜底，渲染安全）
  const evaluatorSystemPrompt = await getRenderedSystemPrompt(supabase, userId, "", "evaluate_prompt");
  const messages: ChatMessage[] = [
    { role: "system", content: evaluatorSystemPrompt },
    { role: "user", content: userContent },
  ];

  // 3. 调用 AI 评估
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const result = await AIService.generate(
    messages,
    {
      temperature: 0.2,
      jsonMode: true,
      ...aiConfig,
    },
    { userId, projectId: "", type: "chat" as never },
    ctx
  );

  const parsed = (result.json || {}) as {
    clarity?: number;
    specificity?: number;
    consistency?: number;
    completeness?: number;
    note?: string;
  };

  const dimensions = {
    clarity: parsed.clarity || 3,
    specificity: parsed.specificity || 3,
    consistency: parsed.consistency || 3,
    completeness: parsed.completeness || 3,
  };

  // 综合分 = 四维度平均，四舍五入
  const score = Math.round(
    (dimensions.clarity + dimensions.specificity + dimensions.consistency + dimensions.completeness) / 4
  );

  const note = parsed.note || "";

  // 4. 更新 prompts 表
  await supabase
    .from("prompts")
    .update({
      quality_score: score,
      quality_note: note,
    })
    .eq("id", promptId);

  return { score, note, dimensions };
}
