import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";
import { sanitizeAge } from "@/lib/ai-actions/assets";
import * as AssetVersions from "@/lib/models/asset-versions";
import { createImpactTask } from "@/lib/lifecycle/impact-engine";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id, characterId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) updateData.name = body.name.trim();
  if (body.role !== undefined) updateData.role = body.role?.trim() || null;
  if (body.age !== undefined) updateData.age = sanitizeAge(body.age);
  if (body.gender !== undefined) updateData.gender = body.gender || null;
  if (body.appearance !== undefined) updateData.appearance = body.appearance?.trim() || null;
  if (body.personality !== undefined) updateData.personality = body.personality?.trim() || null;
  if (body.background !== undefined) updateData.background = body.background?.trim() || null;
  if (body.clothing !== undefined) updateData.clothing = body.clothing?.trim() || null;
  if (body.fixed_prompt !== undefined) updateData.fixed_prompt = body.fixed_prompt.trim();
  if (body.is_locked !== undefined) updateData.is_locked = body.is_locked;

  // fixed_prompt 变更时，先读取旧值用于对比
  let oldFixedPrompt: string | null = null;
  if (body.fixed_prompt !== undefined) {
    const { data: existing } = await supabase
      .from("characters")
      .select("fixed_prompt")
      .eq("id", characterId)
      .eq("project_id", id)
      .maybeSingle();
    oldFixedPrompt = existing?.fixed_prompt ?? null;
  }

  const { data, error } = await supabase
    .from("characters")
    .update(updateData)
    .eq("id", characterId)
    .eq("project_id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // fixed_prompt 变更时：创建版本 + 触发影响传播
  const newFixedPrompt = body.fixed_prompt?.trim() ?? null;
  if (body.fixed_prompt !== undefined && oldFixedPrompt !== newFixedPrompt && newFixedPrompt) {
    const version = await AssetVersions.createVersion({
      entity_type: "character",
      entity_id: characterId,
      project_id: id,
      content: newFixedPrompt,
      source: "manual",
      metadata: { reason: "用户手动编辑角色", changed_fields: ["fixed_prompt"] },
    }, { supabase });

    await createImpactTask(supabase, id, user.id, {
      entity_type: "character",
      entity_id: characterId,
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
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id, characterId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { error } = await supabase
    .from("characters")
    .delete()
    .eq("id", characterId)
    .eq("project_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
