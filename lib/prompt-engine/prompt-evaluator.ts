// ============================================
// Prompt Engine - Prompt 质量评分器
// AI 评估 Prompt 质量 4 维度，输出 1-5 分 + 评语
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
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

const EVALUATOR_SYSTEM_PROMPT = `你是一位严格的 AI 提示词质量评估师。你需要以批判性视角评估 Prompt 质量，不要轻易给高分。

请从以下 4 个维度评估，每个维度打 1-5 分：

## 评分标准

### 1. 清晰度 (clarity)
- 1分：描述混乱、自相矛盾、无法理解
- 2分：存在歧义或逻辑不通顺的地方
- 3分：基本清晰，但有少数模糊表述
- 4分：清晰易懂，仅有极少量可改进之处
- 5分：完美清晰，每个描述都精确无歧义（极少达到）

### 2. 具体性 (specificity)
- 1分：只有笼统描述，无任何具体细节
- 2分：有少量细节，但不足以指导生成
- 3分：有基本细节（角色外貌、场景环境），但缺乏深度
- 4分：细节丰富，包含光影、材质、情绪等具体描述
- 5分：极其详尽，每个视觉元素都有精确描述（极少达到）

### 3. 一致性 (consistency)
- 1分：角色/场景描述与设定严重矛盾
- 2分：存在明显的不一致
- 3分：基本一致，但有小的冲突点
- 4分：一致性良好，仅有个别可改进处
- 5分：完美一致，所有描述都与设定精确匹配（极少达到）

### 4. 完整性 (completeness)
- 1分：缺失多个关键信息（场景、角色、动作等）
- 2分：缺失一些重要信息
- 3分：覆盖基本要素，但有缺失
- 4分：覆盖大部分关键信息，仅有少量遗漏
- 5分：全面覆盖所有生成所需信息，无任何遗漏（极少达到）

## 重要规则
- 默认从严评分，大多数 Prompt 应在 3-4 分区间
- 5分意味着该维度接近完美，这在实际中很少见
- 如果 Prompt 存在明显缺失或可改进之处，不应给 5 分
- note 必须指出具体问题或优点，不能只说"很好"或"需要改进"

请以 JSON 格式输出：
{
  "clarity": 1-5,
  "specificity": 1-5,
  "consistency": 1-5,
  "completeness": 1-5,
  "note": "评语（指出具体优点和不足，80字以内）"
}`;

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

  const messages: ChatMessage[] = [
    { role: "system", content: EVALUATOR_SYSTEM_PROMPT },
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
