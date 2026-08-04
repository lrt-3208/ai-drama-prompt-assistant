// ============================================
// AI 服务层 - 日志记录器（写入 ai_generations 表）
// ============================================

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AICallContext } from "./types";
import type { GenerationType } from "./types";

/** 依赖注入上下文 */
export interface LoggerContext {
  supabase?: SupabaseClient;
}

/** 默认 client（cookie-based） */
async function getDefaultClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

/**
 * 记录一次成功的 AI 调用
 */
export async function logAISuccess(
  context: AICallContext,
  model: string,
  client?: LoggerContext
): Promise<void> {
  try {
    const supabase = client?.supabase ?? await getDefaultClient();
    await supabase.from("ai_generations").insert({
      user_id: context.userId,
      project_id: context.projectId,
      type: context.type,
      model,
      status: "success",
      retry_count: context.retryCount || 0,
    });
  } catch (err) {
    // 日志失败不应影响主流程
    console.error("[AI Logger] 写入成功日志失败:", err);
  }
}

/**
 * 记录一次失败的 AI 调用
 */
export async function logAIFailure(
  context: AICallContext,
  model: string,
  errorMessage: string,
  status: "failed" | "timeout" = "failed",
  client?: LoggerContext
): Promise<void> {
  try {
    const supabase = client?.supabase ?? await getDefaultClient();
    await supabase.from("ai_generations").insert({
      user_id: context.userId,
      project_id: context.projectId,
      type: context.type,
      model,
      status,
      error_message: errorMessage,
      retry_count: context.retryCount || 0,
    });
  } catch (err) {
    console.error("[AI Logger] 写入失败日志失败:", err);
  }
}

/**
 * 查询项目的 AI 调用历史
 */
export async function getAIHistory(
  projectId: string,
  type?: GenerationType
) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  let query = supabase
    .from("ai_generations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (type) {
    query = query.eq("type", type);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
