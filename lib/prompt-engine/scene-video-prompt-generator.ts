// ============================================
// Prompt Engine - 场景视频 Prompt 生成器
// 场景级视频 Prompt：基于 Storyboard + 所有 Shot Image Prompt 生成
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSceneVideoContext, formatSceneContextAsPrompt, type SceneVideoContext } from "./scene-context-builder";
import * as Storyboards from "@/lib/models/storyboards";

/** DI 上下文 */
export interface ScenePromptDI {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 生成结果 */
export interface SceneVideoPromptResult {
  promptId: string;
  versionId: string;
  versionNumber: number;
  content: string;
  negativePrompt: string | null;
}

export const SCENE_VIDEO_SYSTEM_PROMPT = `你是一位顶级 AI 视频提示词工程师，擅长为即梦、Kling、Runway 等视频生成模型编写高质量 Prompt。根据场景信息和镜头序列，生成一段**详尽、专业、可直接用于视频生成**的场景级视频 Prompt。

【核心原则】
1. 场景视频 Prompt 描述的是整个场景的动态视觉呈现，涵盖多个镜头的连续叙事
2. 必须结合所有镜头的 Image Prompt，保持角色外貌、场景设定的视觉一致性
3. 使用 Storyboard 辅助描述理解镜头间的连续性、转场和情绪递进
4. 融入风格预设的 fixed_prompt 风格特征，确保整体风格统一
5. 如有 negative_prompt_rule，在输出中包含负面提示

【Prompt 结构要求（必须包含以下 6 个部分，缺一不可）】

一、场景环境详描（80-150字）
- 时间、天气、光照条件（月光/雨/雾/室内灯等）
- 地点空间结构（空间纵深、材质、碎片、破损程度等）
- 环境氛围与动态元素（雨滴、灰尘、光影闪烁、风吹等）
- 与角色情绪呼应的环境隐喻

二、角色外观与动作（每个角色 60-100字）
- 完整外貌描述（年龄、体型、发型、五官特征、伤疤等）
- 服装详细描述（颜色、材质、配饰、破损等）
- 在场景中的位置和肢体动作（走、蹲、伸手、转身等）
- 面部表情和情绪状态
- 角色之间的空间关系和互动

三、镜头运动与转场（80-120字）
- 开场镜头描述（景别、角度、运动方式：推/拉/摇/移/跟/环绕）
- 镜头之间的转场方式（连续切换、叠化、匹配剪辑等）
- 每个镜头的运镜节奏（缓慢推进/手持微晃/快速跟拍等）
- 景别变化序列（远景→中景→特写等）
- 关键时刻的镜头强调（特写、慢动作、环绕等）

四、光影与色彩氛围（60-100字）
- 主光源类型和方向（自然光/人造光/体积光）
- 明暗对比和阴影描述
- 色调描述（冷/暖、饱和度、去饱和程度）
- 色彩对比关系（如冷调环境与暖色光源的对比）
- 情绪转变时的色彩变化

五、特效与超自然元素（如有，60-100字）
- 粒子效果（光点、灰尘、火花等）
- 能量/光芒/法术效果的视觉描述
- 物理异常（穿透、悬浮、扭曲等）
- 与角色动作的配合关系

六、技术规格与风格关键词（50-80字，英文）
- 摄影技术术语：Cinematic lighting, shallow depth of field, 35mm film grain 等
- 镜头规格：anamorphic lens, volumetric lighting 等
- 画质规格：8k resolution, photorealistic 等
- 情绪/风格关键词

【负面提示词要求】
negative_prompt 应包含：
- 画质负面词：low quality, worst quality, blurry, deformed 等
- 不想要的风格：cartoon, anime, illustration 等
- 场景不相关元素：modern city, sunny day, cheerful 等
- 身体异常：bad anatomy, extra limbs, bad hands 等
- 水印文字：watermark, text, signature 等

【重要提示】
- 正面 Prompt 总字数应在 400-800字（中文部分），确保足够详尽
- 不要简化或概括，每个部分都要有具体、可执行的描述
- 角色描述必须包含完整的 fixed_prompt 内容（年龄、体型、发型、服装等）
- 镜头运动要有明确的起止和节奏
- 特效部分如果有超自然元素，必须详细描述视觉表现
- 技术关键词部分使用英文，与前面的中文描述形成互补

【输出格式】
请以 JSON 格式输出，不要输出任何其他内容：
{
  "prompt": "正面提示词（视频生成用，400-800字）",
  "negative_prompt": "负面提示词（英文逗号分隔）"
}

【语言要求】
- 正面 Prompt 前五部分使用中文描述，第六部分技术规格使用英文
- 负面 Prompt 全部使用英文逗号分隔`;

/**
 * 生成场景级视频 Prompt
 *
 * 前置条件：
 * 1. Storyboard 存在且 status='ready'
 * 2. Storyboard 图片已上传（storyboard_image 不为空）
 * 3. 该 Scene 所有 Shot 都有 Image Prompt
 * 4. 该 Scene 所有 Shot 都有 active 图片资产
 *
 * @param sceneId 场景 ID
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @param platform 平台 (openai_video/jimeng/kling/runway 等)
 * @param language 语言 (zh/en)
 */
export async function generateSceneVideoPrompt(
  sceneId: string,
  projectId: string,
  userId: string,
  platform: string = "jimeng",
  language: "zh" | "en" = "zh",
  ctx?: ScenePromptDI
): Promise<SceneVideoPromptResult> {
  const supabase = ctx?.supabase ?? await getDefaultClient();
  const startTime = Date.now();

  // === 步骤 0: 前置检查 ===

  // 0a. 查询 Storyboard
  const storyboard = await Storyboards.getByScene(sceneId, { supabase });
  if (!storyboard) {
    throw new Error("请先生成 Storyboard 资产");
  }
  if (storyboard.status !== "ready") {
    throw new Error(`Storyboard 状态为 ${storyboard.status}，请先生成 Storyboard`);
  }

  // 0a-2. 检查 Storyboard 图片是否已上传
  if (!storyboard.storyboard_image) {
    throw new Error("请先上传故事板图片后再生成场景视频 Prompt");
  }

  // 0b + 0c. 构建 SceneVideoContext（内部包含 Shot Image Prompt 检查 + 图片资产检查）
  const context = await buildSceneVideoContext(sceneId, { supabase });

  // 0b. 检查所有 Shot 是否有 Image Prompt
  const shotsWithoutPrompt = context.shots.filter((s) => !s.prompt_content);
  if (shotsWithoutPrompt.length > 0) {
    const missingList = shotsWithoutPrompt.map((s) => `镜头 ${s.shot_number}`).join("、");
    throw new Error(`当前场景仍有镜头缺少图片 Prompt（${missingList}）`);
  }

  // 0c. 检查所有 Shot 是否有图片资产
  const shotsWithoutImage = context.shots.filter((s) => !s.asset_id);
  if (shotsWithoutImage.length > 0) {
    const missingList = shotsWithoutImage.map((s) => `镜头 ${s.shot_number}`).join("、");
    throw new Error(`当前场景仍有镜头未生成图片（${missingList}）`);
  }

  // === 步骤 1-8: 上下文已在 buildSceneVideoContext 中构建 ===

  // === 步骤 7: 获取 Prompt 模板 ===
  const { data: template, error: templateError } = await supabase
    .from("prompt_templates")
    .select("id, system_rule, output_format, example, negative_prompt_rule, template_version")
    .eq("platform", platform)
    .eq("prompt_type", "scene_video")
    .eq("language", language)
    .eq("is_active", true)
    .maybeSingle();

  // 如果没有 scene_video 模板，使用内置默认
  const systemRule = template?.system_rule || SCENE_VIDEO_SYSTEM_PROMPT;
  const negativePromptRule = template?.negative_prompt_rule || null;
  const templateId = template?.id || null;
  const templateVersion = template?.template_version || 1;

  // 将 template 版本补充到 dependency_snapshot（与镜头级保持一致）
  if (templateId) {
    (context.dependencySnapshot as Record<string, unknown>).template = {
      id: templateId,
      version_number: templateVersion,
    };
  }

  // === 步骤 8: 格式化上下文 ===
  const userPromptText = formatSceneContextAsPrompt(context);

  // 构建 AI 消息
  const exampleHint = template?.example
    ? `\n\n参考示例：\n${template.example}`
    : "";

  const negativeRuleHint = negativePromptRule
    ? `\n\n【负面提示规则】${negativePromptRule}`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemRule + exampleHint + negativeRuleHint },
    { role: "user", content: userPromptText },
  ];

  // === 步骤 9: 调用 AI 生成（使用 generate 而非 generateJSON 以获取完整结果） ===
  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const aiResult = await AIService.generate(
    messages,
    {
      temperature: 0.5,
      jsonMode: true,
      ...aiConfig,
    },
    {
      userId,
      projectId,
      type: GenerationType.SCENE_VIDEO_PROMPT,
    },
    ctx
  );

  // 解析 AI 输出的 JSON
  const parsed = (aiResult.json || {}) as { prompt?: string; negative_prompt?: string };
  if (!parsed.prompt) {
    throw new Error("AI 返回的内容缺少 prompt 字段");
  }

  const content = parsed.prompt.trim();
  // 合并 AI 输出的 negative_prompt + 模板规则 + 风格预设 negative_prompt
  const negativeParts: string[] = [];
  if (parsed.negative_prompt) negativeParts.push(parsed.negative_prompt);
  if (negativePromptRule) negativeParts.push(negativePromptRule);
  if (context.stylePreset?.negative_prompt) negativeParts.push(context.stylePreset.negative_prompt);
  const negativePrompt = negativeParts.length > 0 ? negativeParts.join(", ") : null;

  const durationMs = Date.now() - startTime;

  // === 步骤 10: 写入 prompts + prompt_versions ===

  // 查找是否已有同类型 prompt 记录
  const { data: existingPrompt } = await supabase
    .from("prompts")
    .select("id")
    .eq("scene_id", sceneId)
    .eq("prompt_type", "scene_video")
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
      .maybeSingle();

    versionNumber = (latestVersion?.version_number || 0) + 1;

    // 取消之前的 is_current 标记
    await supabase
      .from("prompt_versions")
      .update({ is_current: false })
      .eq("prompt_id", promptId)
      .eq("is_current", true);

    // 更新 prompts 表（dependency_snapshot + negative_prompt + 清除 stale）
    await supabase
      .from("prompts")
      .update({
        negative_prompt: negativePrompt,
        dependency_snapshot: context.dependencySnapshot,
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
        scene_id: sceneId,
        shot_id: null,
        episode_id: null,
        prompt_type: "scene_video",
        platform,
        language,
        negative_prompt: negativePrompt,
        dependency_snapshot: context.dependencySnapshot,
        source_prompt_id: null,
      })
      .select("id")
      .single();

    if (newPromptError || !newPrompt) {
      throw new Error(`创建 Scene Video Prompt 记录失败: ${newPromptError?.message}`);
    }

    promptId = newPrompt.id;
    versionNumber = 1;
  }

  // === 步骤 11: 创建 prompt_versions 版本 ===
  const { data: version, error: versionError } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_id: promptId,
      content,
      negative_prompt: negativePrompt,
      version_number: versionNumber,
      is_current: true,
      source: "ai",
      ai_model: aiConfig.model,
      dependency_snapshot: context.dependencySnapshot,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    throw new Error(`创建 Scene Video Prompt 版本失败: ${versionError?.message}`);
  }

  // === 步骤 12: 写入 prompt_generation_records ===
  await supabase.from("prompt_generation_records").insert({
    prompt_id: promptId,
    version_id: version.id,
    project_id: projectId,
    input_context: context.dependencySnapshot,
    template_id: templateId,
    template_version: templateVersion,
    model: aiConfig.model,
    variables: { scene_id: sceneId, platform, language },
    output_snapshot: aiResult.content,
    duration_ms: durationMs,
    prompt_tokens: aiResult.promptTokens || null,
    completion_tokens: aiResult.completionTokens || null,
  });

  return {
    promptId,
    versionId: version.id,
    versionNumber,
    content,
    negativePrompt,
  };
}
