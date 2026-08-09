import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { executeGenerationTask } from "@/lib/tasks/generation-handlers";
import * as Storyboards from "@/lib/models/storyboards";
import { createImpactTask } from "@/lib/lifecycle/impact-engine";

/**
 * PATCH /api/projects/[id]/storyboards/[sceneId]
 *
 * 用户手动编辑 Storyboard assistant_prompt
 * → version_number 自动递增
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
  const { assistant_prompt, storyboard_image } = body as {
    assistant_prompt?: string;
    storyboard_image?: string;
  };

  // 至少提供一个字段
  if (assistant_prompt === undefined && storyboard_image === undefined) {
    return NextResponse.json(
      { error: "请提供 assistant_prompt 或 storyboard_image" },
      { status: 400 }
    );
  }
  if (assistant_prompt !== undefined && !assistant_prompt.trim()) {
    return NextResponse.json(
      { error: "assistant_prompt 不能为空" },
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

  // 4. 更新 Storyboard
  //    - storyboard_image 单独更新（不递增版本号、不保存版本历史）
  //    - assistant_prompt 通过 updateAsset 更新（自动递增版本号 + 保存版本历史）
  if (storyboard_image !== undefined && assistant_prompt === undefined) {
    // 仅更新图片
    const { data: updatedImg, error: imgError } = await supabase
      .from("storyboards")
      .update({ storyboard_image: storyboard_image })
      .eq("id", storyboard.id)
      .select("*")
      .single();
    if (imgError) {
      return NextResponse.json({ error: "更新图片失败" }, { status: 500 });
    }
    return NextResponse.json({
      data: {
        id: updatedImg.id,
        version_number: updatedImg.version_number,
        storyboard_image: updatedImg.storyboard_image,
      },
    });
  }

  // 更新 assistant_prompt（updateAsset 自动递增 version_number + 保存版本历史）
  const updateParams: Parameters<typeof Storyboards.updateAsset>[1] = {
    assistant_prompt: assistant_prompt!.trim(),
    project_id: id,
    source: "manual",
  };
  if (storyboard_image !== undefined) {
    updateParams.storyboard_image = storyboard_image;
  }
  const updated = await Storyboards.updateAsset(
    storyboard.id,
    updateParams,
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
      assistant_prompt: updated.assistant_prompt,
    },
  });
}
