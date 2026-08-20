// ============================================
// AI Action - 资产生成（故事分析 + 角色/场景/风格）
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIService } from "@/lib/ai/ai-service";
import type { ChatMessage } from "@/lib/ai/types";
import { GenerationType } from "@/lib/ai/types";
import { getUserDefaultAIModel } from "@/lib/ai/config";
import { getRenderedSystemPrompt } from "@/lib/ai/node-template-loader";
import * as AssetVersions from "@/lib/models/asset-versions";
import { runImpact } from "@/lib/lifecycle/impact-engine";

/** 依赖注入上下文：不传则 fallback 到 cookie client */
export interface AIActionContext {
  supabase?: SupabaseClient;
}

/** 默认 client（cookie-based，受 RLS 约束）— 现有调用方兼容 */
async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 生成 stable_key（后端生成，AI 禁止生成或修改） */
export function generateStableKey(prefix: "char" | "location" | "style"): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 5; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${suffix}`;
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
  operation: "create" | "update";
  character_ref?: string; // stable_key，operation=update 时必填
  name: string;
  role: string;
  age: string | number;
  gender: string;
  appearance: string;
  personality: string;
  background: string;
  clothing: string;
  fixed_prompt: string;
}

/**
 * 从 AI 返回的 age 值中提取整数。
 * AI 可能返回 "45"、"45岁"、"外貌约45岁（实际数百岁）" 等格式，
 * 取第一个出现的数字作为年龄；提取失败返回 null。
 */
export function sanitizeAge(raw: string | number | undefined | null): number | null {
  if (raw === null || raw === undefined) return null;
  // 已经是数字
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.trunc(raw) : null;
  const str = String(raw).trim();
  if (!str) return null;
  // 提取第一个整数（支持负号）
  const match = str.match(/-?\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  // 合理性校验：年龄在 0-999 之间
  if (num < 0 || num > 999) return null;
  return num;
}

interface GeneratedLocation {
  operation: "create" | "update";
  location_ref?: string; // stable_key，operation=update 时必填
  name: string;
  description: string;
  environment: string;
  time: string;
  weather: string;
  color_style: string;
  fixed_prompt: string;
}

interface GeneratedStyle {
  operation: "create" | "update";
  style_ref?: string; // stable_key，operation=update 时必填
  name: string;
  camera_style: string;
  color: string;
  lighting: string;
  cinematography: string;
  fixed_prompt: string;
  negative_prompt?: string;
}

// ============================================
// 1. enrichStory — 故事分析（模板见 node-registry: story）
// ============================================

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

  // 2. 加载节点模板并调用 AI 生成
  const storySystemPrompt = await getRenderedSystemPrompt(supabase, userId, projectId, "story");
  const messages: ChatMessage[] = [
    { role: "system", content: storySystemPrompt },
    { role: "user", content: `故事创意：${story.raw_input}` },
  ];

  const aiConfig = await getUserDefaultAIModel(supabase, userId);
  const result = await AIService.generateJSON<EnrichedStory>(
    messages,
    { userId, projectId, type: GenerationType.STORY },
    { ...aiConfig },
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
// 2. generateCharacters — 角色生成（merge 模式，模板见 node-registry: character）
// ============================================

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

  // 2. 读取已有角色（含 stable_key + is_locked + fixed_prompt，用于 merge + prompt 感知）
  const { data: existingChars } = await supabase
    .from("characters")
    .select("id, name, role, sort_order, stable_key, is_locked, fixed_prompt")
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
    userParts.push("\n【已有角色】（stable_key 用于 update 关联，请勿捏造不存在的 stable_key）");
    for (const c of existingChars) {
      const lockedTag = c.is_locked ? " [已锁定]" : "";
      userParts.push(`- stable_key: ${c.stable_key} | ${c.name}（${c.role || "未指定"}）${lockedTag}`);
    }
  }

  if (customPrompt) {
    userParts.push(`\n【用户额外要求】\n${customPrompt}`);
  }

  userParts.push("\n请基于以上信息，生成角色列表。已有角色如需修改请用 operation=update + character_ref，新增角色用 operation=create。");

  // 4. 加载节点模板（数量变量由模板渲染注入）
  const characterSystemPrompt = await getRenderedSystemPrompt(supabase, userId, projectId, "character");
  const messages: ChatMessage[] = [
    { role: "system", content: characterSystemPrompt },
    { role: "user", content: userParts.join("\n") },
  ];

  // 5. 调用 AI 生成
  const charAIConfig = await getUserDefaultAIModel(supabase, userId);
  const generated = await AIService.generateJSON<GeneratedCharacter[]>(
    messages,
    { userId, projectId, type: GenerationType.CHARACTER },
    { ...charAIConfig },
    ctx
  );

  // 5. 重新读取已有角色（AI 调用耗时长，期间可能有并发写入）
  const { data: currentChars } = await supabase
    .from("characters")
    .select("id, name, role, sort_order, stable_key, is_locked, fixed_prompt")
    .eq("project_id", projectId)
    .order("sort_order");

  // 6. stable_key + operation 双重策略 merge
  const stableKeyMap = new Map<string, { id: string; is_locked: boolean; fixed_prompt: string | null }>();
  for (const c of currentChars || []) {
    stableKeyMap.set(c.stable_key, { id: c.id, is_locked: c.is_locked, fixed_prompt: c.fixed_prompt });
  }

  let nextSortOrder = (currentChars?.length || 0) + 1;
  let updated = 0;
  let inserted = 0;

  for (const newChar of generated) {
    if (newChar.operation === "update") {
      const ref = newChar.character_ref;
      if (!ref) {
        throw new Error(`角色 ${newChar.name} 的 operation=update 但未提供 character_ref`);
      }
      const existing = stableKeyMap.get(ref);
      if (!existing) {
        // stable_key 不存在则拒绝，不 fallback 为 create
        throw new Error(`角色 ${newChar.name} 的 character_ref (${ref}) 不存在于已有角色中`);
      }
      // is_locked 检查：锁定角色不被 AI 覆盖
      if (existing.is_locked) {
        continue;
      }

      // 检查 fixed_prompt 是否变化
      const oldFixedPrompt = existing.fixed_prompt;
      const newFixedPrompt = newChar.fixed_prompt || null;
      const fixedPromptChanged = oldFixedPrompt !== newFixedPrompt;

      const { error } = await supabase
        .from("characters")
        .update({
          age: sanitizeAge(newChar.age),
          gender: newChar.gender || null,
          appearance: newChar.appearance || null,
          personality: newChar.personality || null,
          background: newChar.background || null,
          clothing: newChar.clothing || null,
          fixed_prompt: newFixedPrompt,
        })
        .eq("id", existing.id);
      if (error) throw new Error(`角色更新失败 (${newChar.name}): ${error.message}`);

      // fixed_prompt 变更时写入 asset_prompt_versions + 触发影响传播
      if (fixedPromptChanged && newFixedPrompt) {
        const version = await AssetVersions.createVersion({
          entity_type: "character",
          entity_id: existing.id,
          project_id: projectId,
          content: newFixedPrompt as string,
          source: "ai",
          ai_model: charAIConfig.model || undefined,
          metadata: { reason: "AI 重新生成角色", changed_fields: ["fixed_prompt"] },
        }, { supabase });

        // 触发影响传播（同步执行，已在异步任务上下文中）
        await runImpact({
          entity_type: "character",
          entity_id: existing.id,
          new_version_number: version.version_number,
          project_id: projectId,
        }, { supabase });
      }
      updated++;
    } else {
      // operation=create → 后端生成 stable_key → insert
      const stableKey = generateStableKey("char");
      const { data: newRec, error } = await supabase
        .from("characters")
        .insert({
          project_id: projectId,
          name: newChar.name,
          role: newChar.role || null,
          age: sanitizeAge(newChar.age),
          gender: newChar.gender || null,
          appearance: newChar.appearance || null,
          personality: newChar.personality || null,
          background: newChar.background || null,
          clothing: newChar.clothing || null,
          fixed_prompt: newChar.fixed_prompt || null,
          stable_key: stableKey,
          sort_order: nextSortOrder++,
        })
        .select("id")
        .single();
      if (error) throw new Error(`角色创建失败 (${newChar.name}): ${error.message}`);

      // 新角色写入初始 asset_prompt_versions
      if (newChar.fixed_prompt) {
        await AssetVersions.createVersion({
          entity_type: "character",
          entity_id: newRec.id,
          project_id: projectId,
          content: newChar.fixed_prompt as string,
          source: "ai",
          ai_model: charAIConfig.model || undefined,
          metadata: { reason: "AI 首次生成角色" },
        }, { supabase });
      }
      inserted++;
    }
  }

  // 不删除 AI 列表中没有的旧角色 — 保留

  return { generated: generated.length, updated: updated + inserted };
}

// ============================================
// 3. generateLocations — 场景生成（merge 模式，模板见 node-registry: location）
// ============================================

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

  // 2. 读取已有场景（含 stable_key + fixed_prompt）
  const { data: existingLocs } = await supabase
    .from("locations")
    .select("id, name, stable_key, fixed_prompt")
    .eq("project_id", projectId)
    .order("created_at");

  // 3. 构建 user prompt
  const userParts: string[] = [];
  userParts.push("【故事创意】");
  userParts.push(`原始输入: ${story.raw_input}`);
  if (story.theme) userParts.push(`主题: ${story.theme}`);
  if (story.genre) userParts.push(`类型: ${story.genre}`);

  if (existingLocs && existingLocs.length > 0) {
    userParts.push("\n【已有场景】（stable_key 用于 update 关联，请勿捏造不存在的 stable_key）");
    for (const l of existingLocs) {
      userParts.push(`- stable_key: ${l.stable_key} | ${l.name}`);
    }
  }

  if (customPrompt) {
    userParts.push(`\n【用户额外要求】\n${customPrompt}`);
  }

  userParts.push("\n请基于以上信息，生成场景列表。已有场景如需修改请用 operation=update + location_ref，新增场景用 operation=create。");

  // 3. 加载节点模板（数量变量由模板渲染注入）
  const locationSystemPrompt = await getRenderedSystemPrompt(supabase, userId, projectId, "location");
  const messages: ChatMessage[] = [
    { role: "system", content: locationSystemPrompt },
    { role: "user", content: userParts.join("\n") },
  ];

  // 4. 调用 AI 生成
  const locAIConfig = await getUserDefaultAIModel(supabase, userId);
  const generated = await AIService.generateJSON<GeneratedLocation[]>(
    messages,
    { userId, projectId, type: GenerationType.LOCATION },
    { ...locAIConfig },
    ctx
  );

  // 5. 重新读取已有场景（AI 调用耗时长，期间可能有并发写入）
  const { data: currentLocs } = await supabase
    .from("locations")
    .select("id, name, stable_key, fixed_prompt")
    .eq("project_id", projectId)
    .order("created_at");

  // 6. stable_key + operation 双重策略 merge
  const stableKeyMap = new Map<string, { id: string; fixed_prompt: string | null }>();
  for (const l of currentLocs || []) {
    stableKeyMap.set(l.stable_key, { id: l.id, fixed_prompt: l.fixed_prompt });
  }

  let updated = 0;
  let inserted = 0;

  for (const newLoc of generated) {
    if (newLoc.operation === "update") {
      const ref = newLoc.location_ref;
      if (!ref) {
        throw new Error(`场景 ${newLoc.name} 的 operation=update 但未提供 location_ref`);
      }
      const existing = stableKeyMap.get(ref);
      if (!existing) {
        throw new Error(`场景 ${newLoc.name} 的 location_ref (${ref}) 不存在于已有场景中`);
      }

      const oldFixedPrompt = existing.fixed_prompt;
      const newFixedPrompt = newLoc.fixed_prompt || null;
      const fixedPromptChanged = oldFixedPrompt !== newFixedPrompt;

      const { error } = await supabase
        .from("locations")
        .update({
          description: newLoc.description || null,
          environment: newLoc.environment || null,
          time: newLoc.time || null,
          weather: newLoc.weather || null,
          color_style: newLoc.color_style || null,
          fixed_prompt: newFixedPrompt,
        })
        .eq("id", existing.id);
      if (error) throw new Error(`场景更新失败 (${newLoc.name}): ${error.message}`);

      // fixed_prompt 变更时写入 asset_prompt_versions + 触发影响传播
      if (fixedPromptChanged && newFixedPrompt) {
        const version = await AssetVersions.createVersion({
          entity_type: "location",
          entity_id: existing.id,
          project_id: projectId,
          content: newFixedPrompt as string,
          source: "ai",
          ai_model: locAIConfig.model || undefined,
          metadata: { reason: "AI 重新生成场景", changed_fields: ["fixed_prompt"] },
        }, { supabase });

        // 触发影响传播（同步执行，已在异步任务上下文中）
        await runImpact({
          entity_type: "location",
          entity_id: existing.id,
          new_version_number: version.version_number,
          project_id: projectId,
        }, { supabase });
      }
      updated++;
    } else {
      // operation=create → 后端生成 stable_key → insert
      const stableKey = generateStableKey("location");
      const { data: newRec, error } = await supabase
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
          stable_key: stableKey,
        })
        .select("id")
        .single();
      if (error) throw new Error(`场景创建失败 (${newLoc.name}): ${error.message}`);

      // 新场景写入初始 asset_prompt_versions
      if (newLoc.fixed_prompt) {
        await AssetVersions.createVersion({
          entity_type: "location",
          entity_id: newRec.id,
          project_id: projectId,
          content: newLoc.fixed_prompt as string,
          source: "ai",
          ai_model: locAIConfig.model || undefined,
          metadata: { reason: "AI 首次生成场景" },
        }, { supabase });
      }
      inserted++;
    }
  }

  return { generated: generated.length, updated: updated + inserted };
}

// ============================================
// 4. generateStyle — 风格生成（upsert，模板见 node-registry: style）
// ============================================

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

  // 2. 读取已有风格（含 stable_key + fixed_prompt）
  const { data: existingStyle } = await supabase
    .from("visual_styles")
    .select("id, name, stable_key, fixed_prompt")
    .eq("project_id", projectId)
    .maybeSingle();

  // 3. 构建 user prompt
  const userParts: string[] = [];
  userParts.push("【故事创意】");
  userParts.push(`原始输入: ${story.raw_input}`);
  if (story.theme) userParts.push(`主题: ${story.theme}`);
  if (story.genre) userParts.push(`类型: ${story.genre}`);
  if (story.core_conflict) userParts.push(`核心冲突: ${story.core_conflict}`);
  if (story.target_emotion) userParts.push(`目标情绪: ${story.target_emotion}`);

  if (existingStyle) {
    userParts.push(`\n【已有风格】stable_key: ${existingStyle.stable_key} | ${existingStyle.name || "未命名"}`);
  }

  if (customPrompt) {
    userParts.push(`\n【用户额外要求】\n${customPrompt}`);
  }

  userParts.push("\n请基于以上信息，生成视觉风格指南。已有风格请用 operation=update + style_ref。");

  // 加载节点模板（与 story/character/location 节点一致的配置化链路）
  const styleSystemPrompt = await getRenderedSystemPrompt(supabase, userId, projectId, "style");
  const messages: ChatMessage[] = [
    { role: "system", content: styleSystemPrompt },
    { role: "user", content: userParts.join("\n") },
  ];

  // 4. 调用 AI 生成
  const styleAIConfig = await getUserDefaultAIModel(supabase, userId);
  const generated = await AIService.generateJSON<GeneratedStyle>(
    messages,
    { userId, projectId, type: GenerationType.STYLE },
    { ...styleAIConfig },
    ctx
  );

  // 5. stable_key + operation 双重策略
  if (generated.operation === "update") {
    const ref = generated.style_ref;
    if (!ref) {
      throw new Error("风格的 operation=update 但未提供 style_ref");
    }
    if (!existingStyle || existingStyle.stable_key !== ref) {
      throw new Error(`风格的 style_ref (${ref}) 不存在于已有风格中`);
    }

    const oldFixedPrompt = existingStyle.fixed_prompt;
    const newFixedPrompt = generated.fixed_prompt || null;
    const fixedPromptChanged = oldFixedPrompt !== newFixedPrompt;

    const { error } = await supabase
      .from("visual_styles")
      .update({
        name: generated.name,
        camera_style: generated.camera_style || null,
        color: generated.color || null,
        lighting: generated.lighting || null,
        cinematography: generated.cinematography || null,
        fixed_prompt: newFixedPrompt,
        negative_prompt: generated.negative_prompt || null,
      })
      .eq("id", existingStyle.id);

    if (error) {
      throw new Error(`风格更新失败: ${error.message}`);
    }

    // 同步回写 projects.visual_style_id（与手动保存 POST /api/projects/[id]/style 行为一致，
    // 否则 scene-context-builder 通过 visual_style_id 关联查询会拿不到风格）
    await supabase
      .from("projects")
      .update({ visual_style_id: existingStyle.id })
      .eq("id", projectId);

    // fixed_prompt 变更时写入 asset_prompt_versions + 触发影响传播
    if (fixedPromptChanged && newFixedPrompt) {
      const version = await AssetVersions.createVersion({
        entity_type: "visual_style",
        entity_id: existingStyle.id,
        project_id: projectId,
        content: newFixedPrompt as string,
        source: "ai",
        ai_model: styleAIConfig.model || undefined,
        metadata: { reason: "AI 重新生成风格", changed_fields: ["fixed_prompt"] },
      }, { supabase });

      // 触发影响传播（同步执行，已在异步任务上下文中）
      await runImpact({
        entity_type: "visual_style",
        entity_id: existingStyle.id,
        new_version_number: version.version_number,
        project_id: projectId,
      }, { supabase });
    }
  } else {
    // operation=create → 后端生成 stable_key → upsert
    const stableKey = generateStableKey("style");
    const { data: newRec, error } = await supabase
      .from("visual_styles")
      .upsert({
        project_id: projectId,
        name: generated.name,
        camera_style: generated.camera_style || null,
        color: generated.color || null,
        lighting: generated.lighting || null,
        cinematography: generated.cinematography || null,
        fixed_prompt: generated.fixed_prompt || null,
        negative_prompt: generated.negative_prompt || null,
        stable_key: stableKey,
      }, { onConflict: "project_id" })
      .select("id")
      .single();

    if (error) {
      throw new Error(`风格保存失败: ${error.message}`);
    }

    // 同步回写 projects.visual_style_id（与手动保存 POST /api/projects/[id]/style 行为一致，
    // 否则 scene-context-builder 通过 visual_style_id 关联查询会拿不到风格）
    await supabase
      .from("projects")
      .update({ visual_style_id: newRec.id })
      .eq("id", projectId);

    // 新风格写入初始 asset_prompt_versions
    if (generated.fixed_prompt) {
      await AssetVersions.createVersion({
        entity_type: "visual_style",
        entity_id: newRec.id,
        project_id: projectId,
        content: generated.fixed_prompt as string,
        source: "ai",
        ai_model: styleAIConfig.model || undefined,
        metadata: { reason: "AI 首次生成风格" },
      }, { supabase });
    }
  }

  return { updated: 1 };
}
