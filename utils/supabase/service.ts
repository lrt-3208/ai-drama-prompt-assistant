import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let serviceInstance: SupabaseClient | null = null;

/**
 * Service Role Client — 绕过 RLS，仅用于内部 task-runner
 * 需要环境变量 SUPABASE_SERVICE_ROLE_KEY
 */
export function createServiceClient(): SupabaseClient {
  if (!serviceInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY 未配置");
    }
    serviceInstance = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return serviceInstance;
}
