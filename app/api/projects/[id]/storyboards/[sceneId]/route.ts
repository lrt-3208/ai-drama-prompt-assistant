import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";
import * as Storyboards from "@/lib/models/storyboards";
import { createImpactTask } from "@/lib/lifecycle/impact-engine";
import type { StoryboardDocument } from "@/lib/storyboard/document-types";

/**
 * PATCH /api/projects/[id]/storyboards/[sceneId]
 *
 * 更新 Storyboard（document 手动编辑）
 * → document 更新通过 updateAsset（自动递增版本号 + 保存版本历史）
 * → 触发 impact（标记引用该 Storyboard 的 Scene Video Prompt stale）
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id, sceneId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // 1. 验证用户 + 项目归属
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 2. 解析 body
  const body = await request.json().catch(() => ({}));
  const { document } = body as {
    document?: StoryboardDocument;
  };

  if (document === undefined) {
    return NextResponse.json(
      { error: "请提供 document" },
      { status: 400 }
    );
  }

  // 3. 查询 Storyboard
  const storyboard = await Storyboards.getByScene(sceneId, { supabase });
  if (!storyboard) {
    return NextResponse.json(
      { error: "Storyboard 不存在，请先生成" },
      { status: 404 }
    );
  }

  // 4. 更新 document（updateAsset 自动递增 version_number + 保存版本历史）
  const updated = await Storyboards.updateAsset(
    storyboard.id,
    {
      document: document!,
      project_id: id,
      source: "manual",
    },
    { supabase }
  );

  // 5. 创建 impact 任务（Storyboard version_number 变更 → Scene Video Prompt stale）
  await createImpactTask(supabase, id, user.id, {
    entity_type: "storyboard",
    entity_id: storyboard.id,
    new_version_number: updated.version_number,
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

  return NextResponse.json({
    data: {
      id: updated.id,
      version_number: updated.version_number,
      document: updated.document,
    },
  });
}
