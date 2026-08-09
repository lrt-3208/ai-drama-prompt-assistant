// ============================================
// Lifecycle - 影响传播引擎
// 资产修改后，对比 dependency_snapshot 判断哪些 Prompt/Storyboard 过期
// 异步执行：由 project_tasks (task_type='run_impact') 调度
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** DI 上下文 */
export interface ImpactDI {
  supabase?: SupabaseClient;
}

async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/** 影响类型 */
export type ImpactEntityType =
  | "character"
  | "location"
  | "visual_style"
  | "storyboard"
  | "template";

/** 影响传播 payload（存储在 project_tasks.progress 中） */
export interface ImpactPayload {
  entity_type: ImpactEntityType;
  entity_id: string;
  new_version_number?: number;
  project_id?: string;
}

/** 影响结果 */
export interface ImpactResult {
  stalePrompts: number;
  staleStoryboards: number;
  details: string[];
}

/**
 * 影响传播引擎入口
 * 由 generation-handlers 在 task_type='run_impact' 时调用
 */
export async function runImpact(
  payload: ImpactPayload,
  ctx?: ImpactDI
): Promise<ImpactResult> {
  const supabase = ctx?.supabase ?? await getDefaultClient();

  switch (payload.entity_type) {
    case "character":
      return handleEntityImpact(payload, supabase, "character");
    case "location":
      return handleEntityImpact(payload, supabase, "location");
    case "visual_style":
      return handleVisualStyleImpact(payload, supabase);
    case "storyboard":
      return handleStoryboardImpact(payload, supabase);
    case "template":
      return handleTemplateImpact(payload, supabase);
    default:
      return { stalePrompts: 0, staleStoryboards: 0, details: [] };
  }
}

// ============================================
// 通用实体影响（character / location）
// 对比 dependency_snapshot 中 version_number
// ============================================

async function handleEntityImpact(
  payload: ImpactPayload,
  supabase: SupabaseClient,
  entityType: "character" | "location"
): Promise<ImpactResult> {
  const result: ImpactResult = { stalePrompts: 0, staleStoryboards: 0, details: [] };
  const entityId = payload.entity_id;
  const newVersion = payload.new_version_number;

  // 获取实体名称 + project_id
  const tableName = entityType === "character" ? "characters" : "locations";
  const { data: entity } = await supabase
    .from(tableName)
    .select("name, project_id")
    .eq("id", entityId)
    .maybeSingle();

  if (!entity) return result;

  const entityName = entity.name;
  const projectId = payload.project_id || entity.project_id;
  // dependency_snapshot 中的 key: "characters"（复数）/ "location" / "visual_style"
  const snapKey = entityType === "character" ? "characters" : entityType;

  // === 镜头级影响：Image Prompt ===
  // 查 shot_characters/scene → 找到关联镜头 → 查 image prompts
  let affectedShotIds: string[] = [];

  if (entityType === "character") {
    const { data: shotChars } = await supabase
      .from("shot_characters")
      .select("shot_id")
      .eq("character_id", entityId);
    affectedShotIds = (shotChars || []).map((sc) => sc.shot_id);
  } else {
    // location → 通过 scene.location_id 找镜头
    const { data: scenes } = await supabase
      .from("scenes")
      .select("id")
      .eq("location_id", entityId);
    const sceneIds = (scenes || []).map((s) => s.id);
    if (sceneIds.length > 0) {
      const { data: shots } = await supabase
        .from("shots")
        .select("id")
        .in("scene_id", sceneIds);
      affectedShotIds = (shots || []).map((s) => s.id);
    }
  }

  if (affectedShotIds.length > 0) {
    const staleIds = await findStalePrompts(
      supabase,
      { shot_id: affectedShotIds, prompt_type: "image" },
      snapKey,
      entityId,
      newVersion
    );

    if (staleIds.length > 0) {
      const reason = `${entityType === "character" ? "角色" : "场景"}'${entityName}'的 fixed_prompt 已修改${newVersion ? `（v${newVersion}）` : ""}`;
      await supabase
        .from("prompts")
        .update({ is_stale: true, stale_reason: reason })
        .in("id", staleIds);
      result.stalePrompts += staleIds.length;
      result.details.push(`镜头级：${staleIds.length} 个 Image Prompt 标记过期`);
    }
  }

  // === 场景级影响：Storyboard + Scene Video Prompt ===
  // 获取受影响的场景
  let affectedSceneIds: string[] = [];

  if (entityType === "character") {
    if (affectedShotIds.length > 0) {
      const { data: shots } = await supabase
        .from("shots")
        .select("scene_id")
        .in("id", affectedShotIds);
      affectedSceneIds = [...new Set((shots || []).map((s) => s.scene_id))];
    }
  } else {
    // location → 直接查 scene_id
    const { data: scenes } = await supabase
      .from("scenes")
      .select("id")
      .eq("location_id", entityId);
    affectedSceneIds = (scenes || []).map((s) => s.id);
  }

  if (affectedSceneIds.length > 0) {
    // Storyboard stale
    const { data: storyboards } = await supabase
      .from("storyboards")
      .select("id, version_number, is_stale")
      .in("scene_id", affectedSceneIds)
      .eq("is_stale", false);

    if (storyboards && storyboards.length > 0) {
      const sbIds = storyboards.map((sb) => sb.id);
      const reason = `${entityType === "character" ? "角色" : "场景"}'${entityName}'已修改，Storyboard 需重新检查`;
      await supabase
        .from("storyboards")
        .update({ is_stale: true, stale_reason: reason })
        .in("id", sbIds);
      result.staleStoryboards += sbIds.length;
      result.details.push(`场景级：${sbIds.length} 个 Storyboard 标记过期`);

      // Scene Video Prompt stale（对比 storyboard.version_number）
      const svStaleIds = await findStaleSceneVideoPrompts(
        supabase,
        affectedSceneIds,
        "storyboard",
        storyboards
      );

      if (svStaleIds.length > 0) {
        const reason = `${entityType === "character" ? "角色" : "场景"}'${entityName}'的修改导致场景视频 Prompt 过期`;
        await supabase
          .from("prompts")
          .update({ is_stale: true, stale_reason: reason })
          .in("id", svStaleIds);
        result.stalePrompts += svStaleIds.length;
        result.details.push(`场景级：${svStaleIds.length} 个 Scene Video Prompt 标记过期`);
      }
    }
  }

  return result;
}

// ============================================
// 视觉风格变更影响（全局：所有 Image Prompt + Scene Video Prompt）
// ============================================

async function handleVisualStyleImpact(
  payload: ImpactPayload,
  supabase: SupabaseClient
): Promise<ImpactResult> {
  const result: ImpactResult = { stalePrompts: 0, staleStoryboards: 0, details: [] };
  const vsId = payload.entity_id;
  const newVersion = payload.new_version_number;

  const { data: vs } = await supabase
    .from("visual_styles")
    .select("name")
    .eq("id", vsId)
    .maybeSingle();

  if (!vs) return result;

  const vsName = vs.name;

  // 查询所有该项目的 Image Prompt
  const staleImageIds = await findStalePrompts(
    supabase,
    { prompt_type: "image", project_id: payload.project_id },
    "visual_style",
    vsId,
    newVersion
  );

  if (staleImageIds.length > 0) {
    const reason = `视觉风格'${vsName}'已修改${newVersion ? `（v${newVersion}）` : ""}`;
    await supabase
      .from("prompts")
      .update({ is_stale: true, stale_reason: reason })
      .in("id", staleImageIds);
    result.stalePrompts += staleImageIds.length;
    result.details.push(`镜头级：${staleImageIds.length} 个 Image Prompt 标记过期`);
  }

  // Scene Video Prompt
  const staleSvIds = await findStalePrompts(
    supabase,
    { prompt_type: "scene_video", project_id: payload.project_id },
    "visual_style",
    vsId,
    newVersion
  );

  if (staleSvIds.length > 0) {
    const reason = `视觉风格'${vsName}'已修改`;
    await supabase
      .from("prompts")
      .update({ is_stale: true, stale_reason: reason })
      .in("id", staleSvIds);
    result.stalePrompts += staleSvIds.length;
    result.details.push(`场景级：${staleSvIds.length} 个 Scene Video Prompt 标记过期`);
  }

  return result;
}

// ============================================
// Storyboard 编辑影响（Scene Video Prompt）
// version_number 递增 → 对比 dependency_snapshot.storyboard.version_number
// ============================================

async function handleStoryboardImpact(
  payload: ImpactPayload,
  supabase: SupabaseClient
): Promise<ImpactResult> {
  const result: ImpactResult = { stalePrompts: 0, staleStoryboards: 0, details: [] };
  const sbId = payload.entity_id;
  const newVersion = payload.new_version_number;

  // 获取 storyboard 的 scene_id
  const { data: sb } = await supabase
    .from("storyboards")
    .select("scene_id, version_number")
    .eq("id", sbId)
    .maybeSingle();

  if (!sb) return result;

  // 查引用该 Storyboard 的 Scene Video Prompt
  const staleIds = await findStaleSceneVideoPrompts(
    supabase,
    [sb.scene_id],
    "storyboard",
    [{ id: sbId, version_number: newVersion ?? sb.version_number, is_stale: false }]
  );

  if (staleIds.length > 0) {
    const reason = `Storyboard 描述已修改（v${newVersion}）`;
    await supabase
      .from("prompts")
      .update({ is_stale: true, stale_reason: reason })
      .in("id", staleIds);
    result.stalePrompts += staleIds.length;
    result.details.push(`场景级：${staleIds.length} 个 Scene Video Prompt 标记过期`);
  }

  return result;
}

// ============================================
// 模板修改影响（所有使用该模板的 Prompt）
// 对比 dependency_snapshot.template.version_number
// ============================================

async function handleTemplateImpact(
  payload: ImpactPayload,
  supabase: SupabaseClient
): Promise<ImpactResult> {
  const result: ImpactResult = { stalePrompts: 0, staleStoryboards: 0, details: [] };
  const templateId = payload.entity_id;
  const newVersion = payload.new_version_number;

  // 获取模板的当前版本号
  let currentVersion = newVersion;
  if (!currentVersion) {
    const { data: tv } = await supabase
      .from("prompt_template_versions")
      .select("version_number")
      .eq("template_id", templateId)
      .eq("is_current", true)
      .maybeSingle();
    currentVersion = tv?.version_number ?? undefined;
  }

  if (!currentVersion) return result;

  // 查询所有 prompt_generation_records 中 template_id 匹配的 prompt_id
  const { data: records } = await supabase
    .from("prompt_generation_records")
    .select("prompt_id, template_version")
    .eq("template_id", templateId);

  if (!records || records.length === 0) return result;

  // 对比 template_version
  const stalePromptIds: string[] = [];
  for (const r of records) {
    if (r.template_version !== currentVersion) {
      stalePromptIds.push(r.prompt_id);
    }
  }

  // 去重 + 过滤已 stale 的
  const uniqueIds = [...new Set(stalePromptIds)];
  if (uniqueIds.length > 0) {
    const { data: prompts } = await supabase
      .from("prompts")
      .select("id")
      .in("id", uniqueIds)
      .eq("is_stale", false);

    const finalIds = (prompts || []).map((p) => p.id);
    if (finalIds.length > 0) {
      const reason = `模板已修改（当前版本 v${currentVersion}）`;
      await supabase
        .from("prompts")
        .update({ is_stale: true, stale_reason: reason })
        .in("id", finalIds);
      result.stalePrompts += finalIds.length;
      result.details.push(`模板变更：${finalIds.length} 个 Prompt 标记过期`);
    }
  }

  return result;
}

// ============================================
// 工具函数
// ============================================

interface PromptFilter {
  shot_id?: string[];
  scene_id?: string[];
  prompt_type: string;
  project_id?: string;
}

/**
 * 查找 dependency_snapshot 中某个实体 version_number 已过期的 Prompt
 * 对比 dependency_snapshot[snapKey] 中 version_number ≠ newVersion
 */
async function findStalePrompts(
  supabase: SupabaseClient,
  filter: PromptFilter,
  snapKey: string,
  entityId: string,
  newVersion: number | undefined
): Promise<string[]> {
  let query = supabase
    .from("prompts")
    .select("id, dependency_snapshot")
    .eq("prompt_type", filter.prompt_type)
    .eq("is_stale", false);

  if (filter.shot_id) query = query.in("shot_id", filter.shot_id);
  if (filter.scene_id) query = query.in("scene_id", filter.scene_id);
  if (filter.project_id) query = query.eq("project_id", filter.project_id);

  const { data: prompts } = await query;
  if (!prompts) return [];

  const staleIds: string[] = [];

  for (const p of prompts) {
    const snapshot = p.dependency_snapshot as Record<string, unknown> | null;
    if (!snapshot) {
      // 旧数据没有 dependency_snapshot，保守标记 stale
      staleIds.push(p.id);
      continue;
    }

    // snapKey 可能是 "characters"（数组）或 "location"/"visual_style"（对象）
    const snapValue = snapshot[snapKey];

    if (Array.isArray(snapValue)) {
      // characters 数组
      const found = snapValue.find(
        (c: unknown) =>
          (c as { id?: string }).id === entityId
      );
      if (!found) continue; // 该 Prompt 不依赖这个实体

      const ver = (found as { version_number?: number | null }).version_number;
      if (ver === undefined || ver === null) {
        // 旧数据没有 version_number，标记 stale
        staleIds.push(p.id);
      } else if (newVersion !== undefined && ver !== newVersion) {
        staleIds.push(p.id);
      }
    } else if (snapValue && typeof snapValue === "object") {
      // location / visual_style 对象
      const obj = snapValue as { id?: string; version_number?: number | null };
      if (obj.id !== entityId) continue;

      const ver = obj.version_number;
      if (ver === undefined || ver === null) {
        staleIds.push(p.id);
      } else if (newVersion !== undefined && ver !== newVersion) {
        staleIds.push(p.id);
      }
    }
  }

  return staleIds;
}

/**
 * 查找 Storyboard 版本变更导致的 Scene Video Prompt 过期
 * 对比 dependency_snapshot.storyboard.version_number
 */
async function findStaleSceneVideoPrompts(
  supabase: SupabaseClient,
  sceneIds: string[],
  _snapKey: string,
  storyboards: Array<{ id: string; version_number: number; is_stale: boolean }>
): Promise<string[]> {
  const { data: prompts } = await supabase
    .from("prompts")
    .select("id, dependency_snapshot, scene_id")
    .in("scene_id", sceneIds)
    .eq("prompt_type", "scene_video")
    .eq("is_stale", false);

  if (!prompts) return [];

  const staleIds: string[] = [];

  for (const p of prompts) {
    const snapshot = p.dependency_snapshot as { storyboard?: { version_number?: number | null } | null } | null;
    if (!snapshot?.storyboard) {
      // 旧数据没有 dependency_snapshot，保守标记 stale
      staleIds.push(p.id);
      continue;
    }

    // 找到该场景对应的 storyboard
    const sb = storyboards.find((s) =>
      s.id === (snapshot.storyboard as { id?: string })?.id
    );

    // 如果找不到对应的 storyboard，或者版本号不匹配
    if (!sb) continue;

    const snapVer = snapshot.storyboard.version_number;
    if (snapVer === undefined || snapVer === null) {
      staleIds.push(p.id);
    } else if (snapVer !== sb.version_number) {
      staleIds.push(p.id);
    }
  }

  return staleIds;
}

/**
 * 创建 impact 异步任务（供其他模块调用）
 * 不阻塞用户操作，由调用方通过 after() + executeGenerationTask 执行
 * 返回 task ID（用于 after() 执行）；如果唯一索引冲突则返回 null
 */
export async function createImpactTask(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  payload: ImpactPayload
): Promise<string | null> {
  const { data, error } = await supabase
    .from("project_tasks")
    .insert({
      project_id: projectId,
      user_id: userId,
      task_type: "run_impact",
      status: "pending",
      payload: payload,
      progress: {},
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 唯一索引冲突 → 另一个任务正在执行，跳过
    console.warn("[impact] Failed to create impact task:", error.message);
    return null;
  }

  return data?.id ?? null;
}
