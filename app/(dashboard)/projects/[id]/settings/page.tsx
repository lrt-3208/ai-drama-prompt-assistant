import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { SettingsView } from "@/components/project/settings-view";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // DB 为唯一配置源
  const { data: aiConfig } = await supabase
    .from("ai_config")
    .select("model, temperature, max_tokens, provider, api_base, api_key")
    .eq("id", 1)
    .maybeSingle();

  const config = {
    provider: aiConfig?.provider || "",
    model: aiConfig?.model || "",
    temperature: aiConfig?.temperature ?? 0.3,
    maxTokens: aiConfig?.max_tokens ?? 4096,
    apiBase: aiConfig?.api_base || "",
    apiKey: aiConfig?.api_key || "",
  };

  return <SettingsView projectId={id} config={config} />;
}
