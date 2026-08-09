import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";
import * as AssetVersions from "@/lib/models/asset-versions";
import { createImpactTask } from "@/lib/lifecycle/impact-engine";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id, locationId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) updateData.name = body.name.trim();
  if (body.description !== undefined) updateData.description = body.description?.trim() || null;
  if (body.environment !== undefined) updateData.environment = body.environment?.trim() || null;
  if (body.time !== undefined) updateData.time = body.time?.trim() || null;
  if (body.weather !== undefined) updateData.weather = body.weather?.trim() || null;
  if (body.color_style !== undefined) updateData.color_style = body.color_style?.trim() || null;
  if (body.fixed_prompt !== undefined) updateData.fixed_prompt = body.fixed_prompt.trim();

  // fixed_prompt 变更时，先读取旧值用于对比
  let oldFixedPrompt: string | null = null;
  if (body.fixed_prompt !== undefined) {
    const { data: existing } = await supabase
      .from("locations")
      .select("fixed_prompt")
      .eq("id", locationId)
      .eq("project_id", id)
      .maybeSingle();
    oldFixedPrompt = existing?.fixed_prompt ?? null;
  }

  const { data, error } = await supabase
    .from("locations")
    .update(updateData)
    .eq("id", locationId)
    .eq("project_id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // fixed_prompt 变更时：创建版本 + 触发影响传播
  const newFixedPrompt = body.fixed_prompt?.trim() ?? null;
  if (body.fixed_prompt !== undefined && oldFixedPrompt !== newFixedPrompt && newFixedPrompt) {
    const version = await AssetVersions.createVersion({
      entity_type: "location",
      entity_id: locationId,
      project_id: id,
      content: newFixedPrompt,
      source: "manual",
      metadata: { reason: "用户手动编辑场景", changed_fields: ["fixed_prompt"] },
    }, { supabase });

    await createImpactTask(supabase, id, user.id, {
      entity_type: "location",
      entity_id: locationId,
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id, locationId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { error } = await supabase
    .from("locations")
    .delete()
    .eq("id", locationId)
    .eq("project_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
