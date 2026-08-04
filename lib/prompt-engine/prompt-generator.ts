// ============================================
// Prompt Engine - Prompt 生成器
// 调用 AI 生成图片/视频 Prompt，保存到 prompts + prompt_versions
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { buildPromptContext, buildVideoPromptContext, formatContextAsPrompt, type PromptEngineContext } from "./context-builder";
import { getShotImageReference } from "./image-reference";
import { getAIConfig } from "@/lib/ai/config";
import type { SupabaseClient } from "@supabase/supabase-js";

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** Prompt 类型 */
export type PromptType = "image" | "video";

/** 生成结果 */
export interface GeneratedPromptResult {
  promptId: string;
  versionId: string;
  versionNumber: number;
  content: string;
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

  // 2. 获取 Prompt 模板（含 output_language）
  const { data: template, error: templateError } = await supabase
    .from("prompt_templates")
    .select("system_rule, output_format, example, output_language")
    .eq("platform", platform)
    .eq("prompt_type", "image")
    .eq("language", language)
    .eq("is_active", true)
    .single();

  if (templateError || !template) {
    throw new Error(
      `未找到匹配的 Prompt 模板 (platform=${platform}, type=image, language=${language})`
    );
  }

  // 3. 格式化上下文（使用模板的 output_language）
  const outputLanguage = (template.output_language as "zh" | "en" | "mixed") || "zh";
  const userPromptText = formatContextAsPrompt(context, outputLanguage);

  // 4. 构建 AI 消息
  const systemRule = template.system_rule;
  const exampleHint = template.example
    ? `\n\n参考示例：\n${template.example}`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemRule + exampleHint },
    { role: "user", content: userPromptText },
  ];

  // 5. 调用 AI 生成
  const aiConfig = await getAIConfig(supabase);
  const result = await AIService.generate(
    messages,
    {
      temperature: 0.4,
      maxTokens: 2048,
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

    // 更新 context_snapshot
    await supabase
      .from("prompts")
      .update({ context_snapshot: context.snapshot })
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

  // 7. 创建新版本
  const { data: version, error: versionError } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_id: promptId,
      content,
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

  return {
    promptId,
    versionId: version.id,
    versionNumber,
    content,
  };
}

/**
 * 生成视频 Prompt（依赖图片资产或图片 Prompt）
 * @param shotId 镜头 ID
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param platform 平台 (doubao_video/jimeng_video/kling/runway/ltx)
 * @param language 语言 (zh/en)
 */
export async function generateVideoPrompt(
  shotId: string,
  projectId: string,
  userId: string,
  platform: string,
  language: "zh" | "en" = "zh",
  ctx?: PromptEngineContext
): Promise<GeneratedPromptResult> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 优先检查图片资产（通过抽象层，MVP 返回 null）
  const imageAsset = await getShotImageReference(shotId);

  let imagePromptContent: string;
  let sourcePromptId: string | null = null;

  if (imageAsset) {
    // V2：使用真实图片描述
    imagePromptContent = imageAsset;
  } else {
    // MVP 回退：查询任意平台的图片 Prompt 最新版本
    const { data: imagePrompt } = await supabase
      .from("prompts")
      .select(
        "id, platform, prompt_versions!inner(id, content, version_number, is_current)"
      )
      .eq("shot_id", shotId)
      .eq("prompt_type", "image")
      // 不限制 platform！任意平台的图片 Prompt 都可
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!imagePrompt) {
      throw new Error("请先生成图片 Prompt 或上传图片资产，再生成视频 Prompt");
    }

    const currentVersion =
      imagePrompt.prompt_versions?.find((v: { is_current: boolean }) => v.is_current) ||
      imagePrompt.prompt_versions?.[0];
    imagePromptContent = currentVersion?.content || "";
    sourcePromptId = imagePrompt.id; // 追溯来源
  }

  // 2. 获取 Prompt 模板（含 output_language）
  const { data: template, error: templateError } = await supabase
    .from("prompt_templates")
    .select("system_rule, output_format, example, output_language")
    .eq("platform", platform)
    .eq("prompt_type", "video")
    .eq("language", language)
    .eq("is_active", true)
    .single();

  if (templateError || !template) {
    throw new Error(
      `未找到匹配的 Prompt 模板 (platform=${platform}, type=video, language=${language})`
    );
  }

  // 3. 构建 Video 上下文（包含图片 Prompt 参考内容）
  const outputLanguage = (template.output_language as "zh" | "en" | "mixed") || "zh";
  const context = await buildVideoPromptContext(shotId, imagePromptContent, ctx);
  const userPromptText = formatContextAsPrompt(context, outputLanguage);

  // 4. 构建 AI 消息
  const systemRule = template.system_rule;
  const exampleHint = template.example
    ? `\n\n参考示例：\n${template.example}`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemRule + exampleHint },
    { role: "user", content: userPromptText },
  ];

  // 5. 调用 AI 生成
  const aiConfig = await getAIConfig(supabase);
  const result = await AIService.generate(
    messages,
    {
      temperature: 0.4,
      maxTokens: 2048,
      ...aiConfig,
    },
    {
      userId,
      projectId,
      type: GenerationType.VIDEO_PROMPT,
    },
    { supabase }
  );

  const content = result.content.trim();

  // 6. 查找是否已有同类型 prompt 记录
  const { data: existingPrompt } = await supabase
    .from("prompts")
    .select("id")
    .eq("shot_id", shotId)
    .eq("prompt_type", "video")
    .eq("platform", platform)
    .eq("language", language)
    .maybeSingle();

  let promptId: string;
  let versionNumber: number;

  if (existingPrompt) {
    promptId = existingPrompt.id;

    const { data: latestVersion } = await supabase
      .from("prompt_versions")
      .select("version_number")
      .eq("prompt_id", promptId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    versionNumber = (latestVersion?.version_number || 0) + 1;

    await supabase
      .from("prompt_versions")
      .update({ is_current: false })
      .eq("prompt_id", promptId)
      .eq("is_current", true);

    // 更新 context_snapshot 和 source_prompt_id
    await supabase
      .from("prompts")
      .update({
        context_snapshot: context.snapshot,
        source_prompt_id: sourcePromptId,
      })
      .eq("id", promptId);
  } else {
    const { data: newPrompt, error: newPromptError } = await supabase
      .from("prompts")
      .insert({
        project_id: projectId,
        shot_id: shotId,
        episode_id: null,
        prompt_type: "video",
        platform,
        language,
        context_snapshot: context.snapshot,
        source_prompt_id: sourcePromptId,
      })
      .select("id")
      .single();

    if (newPromptError || !newPrompt) {
      throw new Error(`创建 Prompt 记录失败: ${newPromptError?.message}`);
    }

    promptId = newPrompt.id;
    versionNumber = 1;
  }

  // 7. 创建新版本
  const { data: version, error: versionError } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_id: promptId,
      content,
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

  return {
    promptId,
    versionId: version.id,
    versionNumber,
    content,
  };
}

/**
 * 批量生成 Prompt（为项目所有镜头生成）
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param promptType 类型 (image/video)
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
          const result =
            promptType === "image"
              ? await generateImagePrompt(sh.id, projectId, userId, platform, language, ctx)
              : await generateVideoPrompt(sh.id, projectId, userId, platform, language, ctx);
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
