import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";
import { generateStableKey } from "@/lib/ai-actions/assets";
import * as AssetVersions from "@/lib/models/asset-versions";
import { createImpactTask } from "@/lib/lifecycle/impact-engine";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { data, error } = await supabase
    .from("visual_styles")
    .select("*")
    .eq("project_id", id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? null });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  if (!body.name?.trim()) return NextResponse.json({ error: "风格名称不能为空" }, { status: 400 });
  if (!body.fixed_prompt?.trim()) return NextResponse.json({ error: "固定 Prompt 不能为空" }, { status: 400 });

  // 检查是否已有风格（决定是否生成 stable_key + 对比 fixed_prompt）
  const { data: existing } = await supabase
    .from("visual_styles")
    .select("id, fixed_prompt")
    .eq("project_id", id)
    .maybeSingle();

  const oldFixedPrompt = existing?.fixed_prompt ?? null;

  const insertData: Record<string, unknown> = {
    project_id: id,
    name: body.name.trim(),
    camera_style: body.camera_style?.trim() || null,
    color: body.color?.trim() || null,
    lighting: body.lighting?.trim() || null,
    cinematography: body.cinematography?.trim() || null,
    fixed_prompt: body.fixed_prompt.trim(),
    negative_prompt: body.negative_prompt?.trim() || null,
  };

  if (!existing) {
    insertData.stable_key = generateStableKey("style");
  }

  const { data, error } = await supabase
    .from("visual_styles")
    .upsert(insertData, { onConflict: "project_id" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 同步更新 projects.visual_style_id
  await supabase
    .from("projects")
    .update({ visual_style_id: data.id })
    .eq("id", id);

  // fixed_prompt 变更时：创建版本 + 触发影响传播
  const newFixedPrompt = body.fixed_prompt?.trim() ?? null;
  if (oldFixedPrompt !== newFixedPrompt && newFixedPrompt) {
    const version = await AssetVersions.createVersion({
      entity_type: "visual_style",
      entity_id: data.id,
      project_id: id,
      content: newFixedPrompt,
      source: "manual",
      metadata: { reason: "用户手动编辑风格", changed_fields: ["fixed_prompt"] },
    }, { supabase });

    await createImpactTask(supabase, id, user.id, {
      entity_type: "visual_style",
      entity_id: data.id,
      new_version_number: version.version_number,
      project_id: id,
    }).then((impactTaskId) => {
      if (impactTaskId) {
        after(async () => {
          try {
            const serviceClient = createServiceClient();
            await executeGenerationTask(serviceClient, impactTaskId);
          } catch (e) {
            console.error("[impact] after() execution failed:", e);
          }
        });
      }
    });
  }

  return NextResponse.json({ data });
}
