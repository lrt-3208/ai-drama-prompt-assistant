// ============================================
// AI Action - 资产生成（故事分析 + 角色/场景/风格）
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { getAIConfig } from "@/lib/ai/config";

/** 依赖注入上下文：不传则 fallback 到 cookie client */
export interface AIActionContext {
  supabase?: SupabaseClient;
}

/** 默认 client（cookie-based，受 RLS 约束）— 现有调用方兼容 */
async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

// ============================================
// 类型定义
// ============================================

interface EnrichedStory {
  theme: string;
  core_conflict: string;
  target_emotion: string;
  genre: string;
}

interface GeneratedCharacter {
  name: string;
  role: string;
  age: string;
  gender: string;
  appearance: string;
  personality: string;
  background: string;
  clothing: string;
  fixed_prompt: string;
}

interface GeneratedLocation {
  name: string;
  description: string;
  environment: string;
  time: string;
  weather: string;
  color_style: string;
  fixed_prompt: string;
}

interface GeneratedStyle {
  name: string;
  camera_style: string;
  color: string;
  lighting: string;
  cinematography: string;
  fixed_prompt: string;
}

// ============================================
// 1. enrichStory — 故事分析
// ============================================

const STORY_SYSTEM_PROMPT = `你是一位专业的短剧故事分析师。根据用户输入的故事创意，分析并生成结构化故事元数据。

【语言要求】所有字段内容必须用中文输出。

要求：
1. theme: 故事主题（如"重生复仇豪门"、"都市爱情成长"）
2. core_conflict: 核心冲突（一句话概括，如"被背叛后重返家族夺回一切"）
3. target_emotion: 目标情绪基调（如"爽感+紧张+释放"）
4. genre: 剧本类型（如"都市/悬疑/古风/甜宠/复仇"）

请以 JSON 格式输出，不要输出任何其他内容：
{
  "theme": "...",
  "core_conflict": "...",
  "target_emotion": "...",
  "genre": "..."
}`;

export async function enrichStory(
  projectId: string,
  userId: string,
  ctx?: AIActionContext
): Promise<EnrichedStory> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 读取故事数据
  const { data: story, error: storyError } = await supabase
    .from("stories")
    .select("raw_input, theme, genre, core_conflict, target_emotion")
    .eq("project_id", projectId)
    .single();

  if (storyError || !story) {
    throw new Error("未找到故事数据，无法分析");
  }

  // 2. 调用 AI 生成
  const messages: ChatMessage[] = [
    { role: "system", content: STORY_SYSTEM_PROMPT },
    { role: "user", content: `故事创意：${story.raw_input}` },
  ];

  const aiConfig = await getAIConfig(supabase);
  const result = await AIService.generateJSON<EnrichedStory>(
    messages,
    { userId, projectId, type: GenerationType.STORY },
    { maxTokens: 1024, ...aiConfig },
    ctx
  );

  // 3. 更新 stories 表（只补充字段，不覆盖 raw_input）
  const { error: updateError } = await supabase
    .from("stories")
    .update({
      theme: result.theme,
      core_conflict: result.core_conflict,
      target_emotion: result.target_emotion,
      genre: result.genre,
    })
    .eq("project_id", projectId);

  if (updateError) {
    throw new Error(`故事分析结果保存失败: ${updateError.message}`);
  }

  return result;
}

// ============================================
// 2. generateCharacters — 角色生成（merge 模式）
// ============================================

const CHARACTER_SYSTEM_PROMPT = `你是一位专业的短剧角色设计师。根据故事创意，生成 3-6 个角色。

【语言要求】所有描述性字段（name/appearance/personality/background/clothing）必须用中文输出，仅 fixed_prompt 用英文。

每个角色包含：
- name: 角色名字（中文）
- role: 角色类型（主角/配角/反派）
- age: 年龄（如"25"）
- gender: 性别
- appearance: 外貌描述（中文，详细，用于视觉一致性）
- personality: 性格描述（中文）
- background: 背景故事（中文）
- clothing: 标志性服装描述（中文）
- fixed_prompt: 固定视觉 Prompt（英文，用于图片生成一致性锁定，描述外貌+服装+特征，如"young Chinese man, short black hair, sharp eyes, wearing dark suit, confident expression"）

【重要 — 保护用户修改】
如果提供了已有角色列表，以下规则必须遵守：
1. 已有角色的 name 和 role 不可更改（除非用户明确要求修改）
2. 已有角色的其他字段（appearance/personality/background/clothing/fixed_prompt）尽量保持原值
3. 优先新增角色满足用户要求，不要重写已有角色
4. 仅当用户明确要求"修改某角色"时才修改已有角色

请以 JSON 数组格式输出，不要输出任何其他内容：
[
  {
    "name": "...",
    "role": "...",
    "age": "...",
    "gender": "...",
    "appearance": "...",
    "personality": "...",
    "background": "...",
    "clothing": "...",
    "fixed_prompt": "..."
  }
]`;

export async function generateCharacters(
  projectId: string,
  userId: string,
  customPrompt?: string,
  ctx?: AIActionContext
): Promise<{ generated: number; updated: number }> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 读取故事数据（含元数据）
  const { data: story } = await supabase
    .from("stories")
    .select("raw_input, theme, genre, core_conflict, target_emotion")
    .eq("project_id", projectId)
    .single();

  if (!story) {
    throw new Error("未找到故事数据");
  }

  // 2. 读取已有角色（用于 merge + prompt 感知）
  const { data: existingChars } = await supabase
    .from("characters")
    .select("id, name, role, sort_order")
    .eq("project_id", projectId)
    .order("sort_order");

  // 3. 构建 user prompt
  const userParts: string[] = [];
  userParts.push("【故事创意】");
  userParts.push(`原始输入: ${story.raw_input}`);
  if (story.theme) userParts.push(`主题: ${story.theme}`);
  if (story.genre) userParts.push(`类型: ${story.genre}`);
  if (story.core_conflict) userParts.push(`核心冲突: ${story.core_conflict}`);
  if (story.target_emotion) userParts.push(`目标情绪: ${story.target_emotion}`);

  if (existingChars && existingChars.length > 0) {
    userParts.push("\n【已有角色】（请保留这些角色，不要删除或重写）");
    for (const c of existingChars) {
      userParts.push(`- ${c.name}（${c.role || "未指定"}）`);
    }
  }

  if (customPrompt) {
    userParts.push(`\n【用户额外要求】\n${customPrompt}`);
  }

  userParts.push("\n请基于以上信息，生成角色列表。如果已有角色，请保留并酌情新增。");

  const messages: ChatMessage[] = [
    { role: "system", content: CHARACTER_SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];

  // 4. 调用 AI 生成
  const charAIConfig = await getAIConfig(supabase);
  const generated = await AIService.generateJSON<GeneratedCharacter[]>(
    messages,
    { userId, projectId, type: GenerationType.CHARACTER },
    { maxTokens: 4096, ...charAIConfig },
    ctx
  );

  // 5. 重新读取已有角色（AI 调用耗时长，期间可能有并发写入）
  const { data: currentChars } = await supabase
    .from("characters")
    .select("id, name, role, sort_order")
    .eq("project_id", projectId)
    .order("sort_order");

  // 6. Merge 模式保存（按 name 唯一匹配，防止重名角色）
  const existingMap = new Map<string, string>(); // key: name（小写），value: id
  for (const c of currentChars || []) {
    existingMap.set(c.name.trim().toLowerCase(), c.id);
  }

  let nextSortOrder = (currentChars?.length || 0) + 1;
  let updated = 0;
  let inserted = 0;

  for (const newChar of generated) {
    const matchKey = newChar.name.trim().toLowerCase();
    const existingId = existingMap.get(matchKey);

    if (existingId) {
      // 匹配到 → update（保留 id 和 sort_order）
      const { error } = await supabase
        .from("characters")
        .update({
          age: newChar.age || null,
          gender: newChar.gender || null,
          appearance: newChar.appearance || null,
          personality: newChar.personality || null,
          background: newChar.background || null,
          clothing: newChar.clothing || null,
          fixed_prompt: newChar.fixed_prompt || null,
        })
        .eq("id", existingId);
      if (error) throw new Error(`角色更新失败 (${newChar.name}): ${error.message}`);
      updated++;
    } else {
      // 未匹配到 → insert
      const { error } = await supabase
        .from("characters")
        .insert({
          project_id: projectId,
          name: newChar.name,
          role: newChar.role || null,
          age: newChar.age || null,
          gender: newChar.gender || null,
          appearance: newChar.appearance || null,
          personality: newChar.personality || null,
          background: newChar.background || null,
          clothing: newChar.clothing || null,
          fixed_prompt: newChar.fixed_prompt || null,
          sort_order: nextSortOrder++,
        });
      if (error) throw new Error(`角色创建失败 (${newChar.name}): ${error.message}`);
      inserted++;
    }
  }

  // 不删除 AI 列表中没有的旧角色 — 保留

  return { generated: generated.length, updated: updated + inserted };
}

// ============================================
// 3. generateLocations — 场景生成（merge 模式）
// ============================================

const LOCATION_SYSTEM_PROMPT = `你是一位专业的短剧场景设计师。根据故事创意，生成 3-5 个核心场景。

【语言要求】所有描述性字段（name/description/environment/time/weather/color_style）必须用中文输出，仅 fixed_prompt 用英文。

每个场景包含：
- name: 场景名称（中文，如"豪门客厅"、"雨夜街道"）
- description: 场景描述（中文）
- environment: 环境描述（中文，如"现代豪华装修"、"古代庭院"）
- time: 时间设定（中文，如"白天"、"夜晚"、"黄昏"）
- weather: 天气氛围（中文，如"晴朗"、"暴雨"、"阴天"）
- color_style: 色彩风格（中文，如"暖色调"、"冷色调"、"高对比度"）
- fixed_prompt: 固定视觉 Prompt（英文，用于图片生成一致性锁定）

【重要 — 保护用户修改】
如果提供了已有场景列表，请保留已有场景，优先新增场景满足用户要求。

请以 JSON 数组格式输出，不要输出任何其他内容：
[
  {
    "name": "...",
    "description": "...",
    "environment": "...",
    "time": "...",
    "weather": "...",
    "color_style": "...",
    "fixed_prompt": "..."
  }
]`;

export async function generateLocations(
  projectId: string,
  userId: string,
  customPrompt?: string,
  ctx?: AIActionContext
): Promise<{ generated: number; updated: number }> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 读取故事数据
  const { data: story } = await supabase
    .from("stories")
    .select("raw_input, theme, genre, core_conflict, target_emotion")
    .eq("project_id", projectId)
    .single();

  if (!story) {
    throw new Error("未找到故事数据");
  }

  // 2. 读取已有场景
  const { data: existingLocs } = await supabase
    .from("locations")
    .select("id, name")
    .eq("project_id", projectId)
    .order("created_at");

  // 3. 构建 user prompt
  const userParts: string[] = [];
  userParts.push("【故事创意】");
  userParts.push(`原始输入: ${story.raw_input}`);
  if (story.theme) userParts.push(`主题: ${story.theme}`);
  if (story.genre) userParts.push(`类型: ${story.genre}`);

  if (existingLocs && existingLocs.length > 0) {
    userParts.push("\n【已有场景】（请保留这些场景，不要删除或重写）");
    for (const l of existingLocs) {
      userParts.push(`- ${l.name}`);
    }
  }

  if (customPrompt) {
    userParts.push(`\n【用户额外要求】\n${customPrompt}`);
  }

  userParts.push("\n请基于以上信息，生成场景列表。");

  const messages: ChatMessage[] = [
    { role: "system", content: LOCATION_SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];

  // 4. 调用 AI 生成
  const locAIConfig = await getAIConfig(supabase);
  const generated = await AIService.generateJSON<GeneratedLocation[]>(
    messages,
    { userId, projectId, type: GenerationType.LOCATION },
    { maxTokens: 4096, ...locAIConfig },
    ctx
  );

  // 5. 重新读取已有场景（AI 调用耗时长，期间可能有并发写入）
  const { data: currentLocs } = await supabase
    .from("locations")
    .select("id, name")
    .eq("project_id", projectId)
    .order("created_at");

  // 6. Merge 模式保存（按 name 匹配）
  const existingMap = new Map<string, string>();
  for (const l of currentLocs || []) {
    existingMap.set(l.name, l.id);
  }

  let updated = 0;
  let inserted = 0;

  for (const newLoc of generated) {
    const existingId = existingMap.get(newLoc.name);

    if (existingId) {
      const { error } = await supabase
        .from("locations")
        .update({
          description: newLoc.description || null,
          environment: newLoc.environment || null,
          time: newLoc.time || null,
          weather: newLoc.weather || null,
          color_style: newLoc.color_style || null,
          fixed_prompt: newLoc.fixed_prompt || null,
        })
        .eq("id", existingId);
      if (error) throw new Error(`场景更新失败 (${newLoc.name}): ${error.message}`);
      updated++;
    } else {
      const { error } = await supabase
        .from("locations")
        .insert({
          project_id: projectId,
          name: newLoc.name,
          description: newLoc.description || null,
          environment: newLoc.environment || null,
          time: newLoc.time || null,
          weather: newLoc.weather || null,
          color_style: newLoc.color_style || null,
          fixed_prompt: newLoc.fixed_prompt || null,
        });
      if (error) throw new Error(`场景创建失败 (${newLoc.name}): ${error.message}`);
      inserted++;
    }
  }

  return { generated: generated.length, updated: updated + inserted };
}

// ============================================
// 4. generateStyle — 风格生成（upsert）
// ============================================

const STYLE_SYSTEM_PROMPT = `你是一位专业的短剧视觉风格设计师。根据故事创意，生成 1 条视觉风格指南。

【语言要求】所有描述性字段（name/camera_style/color/lighting/cinematography）必须用中文输出，仅 fixed_prompt 用英文。

包含：
- name: 风格名称（中文，如"都市质感风"、"古风唯美"）
- camera_style: 摄影风格（中文，如"手持跟拍+稳定器"、"电影感固定机位"）
- color: 色彩风格（中文，如"冷色调+高饱和度"、"暖色调+柔和"）
- lighting: 光影风格（中文，如"自然光+逆光剪影"、"戏剧性侧光"）
- cinematography: 镜头语言（中文，如"浅景深特写+广角全景"、"快速剪辑+慢镜头过渡"）
- fixed_prompt: 固定视觉 Prompt（英文，用于图片生成一致性锁定，如"cinematic shot, cool color palette, natural lighting, shallow depth of field, film grain texture"）

请以 JSON 格式输出，不要输出任何其他内容：
{
  "name": "...",
  "camera_style": "...",
  "color": "...",
  "lighting": "...",
  "cinematography": "...",
  "fixed_prompt": "..."
}`;

export async function generateStyle(
  projectId: string,
  userId: string,
  customPrompt?: string,
  ctx?: AIActionContext
): Promise<{ updated: number }> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  // 1. 读取故事数据
  const { data: story } = await supabase
    .from("stories")
    .select("raw_input, theme, genre, core_conflict, target_emotion")
    .eq("project_id", projectId)
    .single();

  if (!story) {
    throw new Error("未找到故事数据");
  }

  // 2. 构建 user prompt
  const userParts: string[] = [];
  userParts.push("【故事创意】");
  userParts.push(`原始输入: ${story.raw_input}`);
  if (story.theme) userParts.push(`主题: ${story.theme}`);
  if (story.genre) userParts.push(`类型: ${story.genre}`);
  if (story.core_conflict) userParts.push(`核心冲突: ${story.core_conflict}`);
  if (story.target_emotion) userParts.push(`目标情绪: ${story.target_emotion}`);

  if (customPrompt) {
    userParts.push(`\n【用户额外要求】\n${customPrompt}`);
  }

  userParts.push("\n请基于以上信息，生成视觉风格指南。");

  const messages: ChatMessage[] = [
    { role: "system", content: STYLE_SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];

  // 3. 调用 AI 生成
  const styleAIConfig = await getAIConfig(supabase);
  const generated = await AIService.generateJSON<GeneratedStyle>(
    messages,
    { userId, projectId, type: GenerationType.STYLE },
    { maxTokens: 2048, ...styleAIConfig },
    ctx
  );

  // 4. Upsert 到 visual_styles 表
  const { error } = await supabase
    .from("visual_styles")
    .upsert({
      project_id: projectId,
      name: generated.name,
      camera_style: generated.camera_style || null,
      color: generated.color || null,
      lighting: generated.lighting || null,
      cinematography: generated.cinematography || null,
      fixed_prompt: generated.fixed_prompt || null,
    }, { onConflict: "project_id" });

  if (error) {
    throw new Error(`风格保存失败: ${error.message}`);
  }

  return { updated: 1 };
}
