// ============================================
// Prompt Engine - Prompt 生成器
// 调用 AI 生成图片 Prompt，保存到 prompts + prompt_versions
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { buildPromptContext, formatContextAsPrompt, type PromptEngineContext } from "./context-builder";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import type { SupabaseClient } from "@supabase/supabase-js";

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** Prompt 类型 */
export type PromptType = "image";

/** 生成结果 */
export interface GeneratedPromptResult {
  promptId: string;
  versionId: string;
  versionNumber: number;
  content: string;
  negativePrompt: string | null;
}

/**
 * 生成图片 Prompt
 * @param shotId 镜头 ID
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param platform 平台 (openai_image/jimeng/midjourney/flux/comfyui)
 * @param language 语言 (zh/en)
 */
export async function generateImagePrompt(
  shotId: string,
  projectId: string,
  userId: string,
  platform: string,
  language: "zh" | "en" = "zh",
  ctx?: PromptEngineContext
): Promise<GeneratedPromptResult> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 构建上下文
  const context = await buildPromptContext(shotId, ctx);

  const startTime = Date.now();

  // 2. 获取 Prompt 模板（含 output_language + negative_prompt_rule + template_version）
  const { data: template, error: templateError } = await supabase
    .from("prompt_templates")
    .select("id, system_rule, output_format, example, output_language, negative_prompt_rule, template_version")
    .eq("platform", platform)
    .eq("prompt_type", "image")
    .eq("language", language)
    .eq("is_active", true)
    .maybeSingle();

  if (templateError || !template) {
    throw new Error(
      `未找到匹配的 Prompt 模板 (platform=${platform}, type=image, language=${language})`
    );
  }

  // 2b. 查询项目级 style_preset
  let stylePreset: { id: string; fixed_prompt: string; negative_prompt: string | null } | null = null;
  const { data: project } = await supabase
    .from("projects")
    .select("style_preset_id")
    .eq("id", projectId)
    .maybeSingle();
  if (project?.style_preset_id) {
    const { data: preset } = await supabase
      .from("style_presets")
      .select("id, fixed_prompt, negative_prompt")
      .eq("id", project.style_preset_id)
      .maybeSingle();
    if (preset) stylePreset = preset;
  }

  // 3. 格式化上下文（使用模板的 output_language）
  const outputLanguage = (template.output_language as "zh" | "en" | "mixed") || "zh";
  const userPromptText = formatContextAsPrompt(context, outputLanguage);

  // 4. 构建 AI 消息（注入 negative_prompt_rule + style_preset）
  const systemRule = template.system_rule;
  const exampleHint = template.example
    ? `\n\n参考示例：\n${template.example}`
    : "";
  const negativeRuleHint = template.negative_prompt_rule
    ? `\n\n【负面提示规则】${template.negative_prompt_rule}`
    : "";
  const stylePresetHint = stylePreset
    ? `\n\n【风格预设】${stylePreset.fixed_prompt}`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemRule + exampleHint + negativeRuleHint + stylePresetHint },
    { role: "user", content: userPromptText },
  ];

  // 5. 调用 AI 生成
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const result = await AIService.generate(
    messages,
    {
      temperature: 0.4,
      ...aiConfig,
    },
    {
      userId,
      projectId,
      type: GenerationType.IMAGE_PROMPT,
    },
    { supabase }
  );

  const content = result.content.trim();

  // 5b. 构建 negative_prompt（合并模板规则 + 风格预设 negative_prompt）
  const negativeParts: string[] = [];
  if (template.negative_prompt_rule) negativeParts.push(template.negative_prompt_rule);
  if (stylePreset?.negative_prompt) negativeParts.push(stylePreset.negative_prompt);
  const negativePrompt = negativeParts.length > 0 ? negativeParts.join(", ") : null;

  // 5c. 构建 dependency_snapshot
  const dependencySnapshot = {
    characters: (context.characters || []).map((c) => ({
      id: c.id,
      name: c.name,
      version_number: c.version_number,
    })),
    location: context.location
      ? { id: context.location.id, name: context.location.name, version_number: context.location.version_number }
      : null,
    visual_style: context.visualStyle
      ? { id: context.visualStyle.id, name: context.visualStyle.name, version_number: context.visualStyle.version_number }
      : null,
    style_preset: stylePreset ? { id: stylePreset.id } : null,
    template: { id: template.id, version_number: template.template_version || 1 },
  };

  const durationMs = Date.now() - startTime;

  // 6. 查找是否已有同类型 prompt 记录
  const { data: existingPrompt } = await supabase
    .from("prompts")
    .select("id")
    .eq("shot_id", shotId)
    .eq("prompt_type", "image")
    .eq("platform", platform)
    .eq("language", language)
    .maybeSingle();

  let promptId: string;
  let versionNumber: number;

  if (existingPrompt) {
    // 已有记录，创建新版本
    promptId = existingPrompt.id;

    const { data: latestVersion } = await supabase
      .from("prompt_versions")
      .select("version_number")
      .eq("prompt_id", promptId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    versionNumber = (latestVersion?.version_number || 0) + 1;

    // 取消之前的 is_current 标记
    await supabase
      .from("prompt_versions")
      .update({ is_current: false })
      .eq("prompt_id", promptId)
      .eq("is_current", true);

    // 更新 context_snapshot + negative_prompt + dependency_snapshot + 清除 stale
    await supabase
      .from("prompts")
      .update({
        context_snapshot: context.snapshot,
        negative_prompt: negativePrompt,
        dependency_snapshot: dependencySnapshot,
        is_stale: false,
        stale_reason: null,
      })
      .eq("id", promptId);
  } else {
    // 新记录
    const { data: newPrompt, error: newPromptError } = await supabase
      .from("prompts")
      .insert({
        project_id: projectId,
        shot_id: shotId,
        episode_id: null,
        prompt_type: "image",
        platform,
        language,
        context_snapshot: context.snapshot,
        negative_prompt: negativePrompt,
        dependency_snapshot: dependencySnapshot,
        source_prompt_id: null,
      })
      .select("id")
      .single();

    if (newPromptError || !newPrompt) {
      throw new Error(`创建 Prompt 记录失败: ${newPromptError?.message}`);
    }

    promptId = newPrompt.id;
    versionNumber = 1;
  }

  // 7. 创建新版本（含 negative_prompt + dependency_snapshot）
  const { data: version, error: versionError } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_id: promptId,
      content,
      negative_prompt: negativePrompt,
      dependency_snapshot: dependencySnapshot,
      version_number: versionNumber,
      is_current: true,
      source: "ai",
      ai_model: result.model,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    throw new Error(`创建 Prompt 版本失败: ${versionError?.message}`);
  }

  // 8. 写入 prompt_generation_records
  await supabase.from("prompt_generation_records").insert({
    prompt_id: promptId,
    version_id: version.id,
    project_id: projectId,
    input_context: context.snapshot,
    template_id: template.id,
    template_version: template.template_version || 1,
    model: result.model,
    variables: { shot_id: shotId, platform, language },
    output_snapshot: content,
    duration_ms: durationMs,
    prompt_tokens: result.promptTokens || null,
    completion_tokens: result.completionTokens || null,
  });

  return {
    promptId,
    versionId: version.id,
    versionNumber,
    content,
    negativePrompt,
  };
}

/**
 * 批量生成 Prompt（为项目所有镜头生成）
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param promptType 类型 (image)
 * @param platform 平台
 * @param language 语言
 * @returns 生成结果列表
 */
export async function generatePromptsBatch(
  projectId: string,
  userId: string,
  promptType: PromptType,
  platform: string,
  language: "zh" | "en" = "zh",
  ctx?: PromptEngineContext
): Promise<GeneratedPromptResult[]> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  const { data: episodes } = await supabase
    .from("episodes")
    .select("id, scenes(id, shots(id))")
    .eq("project_id", projectId)
    .order("episode_number");

  if (!episodes) return [];

  const results: GeneratedPromptResult[] = [];
  const errors: string[] = [];

  for (const ep of episodes) {
    if (!ep.scenes) continue;
    for (const sc of ep.scenes as Array<{ id: string; shots?: Array<{ id: string }> }>) {
      if (!sc.shots) continue;
      for (const sh of sc.shots) {
        try {
          const result = await generateImagePrompt(sh.id, projectId, userId, platform, language, ctx);
          results.push(result);
        } catch (err) {
          errors.push(
            `镜头 ${sh.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.warn("[Prompt Generator] 批量生成部分失败:", errors);
  }

  return results;
}
