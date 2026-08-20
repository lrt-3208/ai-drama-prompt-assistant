import { describe, expect, it, vi } from "vitest";
import { getActiveNodeTemplate } from "@/lib/ai/node-template-loader";
import { DEFAULT_GENERATION_CONFIG } from "@/lib/ai-actions/config";

/** 轻量 supabase mock：按表名返回预置数据，链式方法全部穿透 */
function makeMockSupabase(tables: {
  project?: Record<string, unknown> | null;
  story?: Record<string, unknown> | null;
  style?: Record<string, unknown> | null;
  templates?: Array<Record<string, unknown>>;
}) {
  const calls: string[] = [];
  const chain = (result: unknown) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      or: () => builder,
      maybeSingle: () => builder,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: result, error: null }),
    };
    return builder;
  };
  return {
    calls,
    from: (table: string) => {
      calls.push(table);
      if (table === "projects") return chain(tables.project === undefined ? null : tables.project);
      if (table === "stories") return chain(tables.story === undefined ? null : tables.story);
      if (table === "visual_styles") return chain(tables.style === undefined ? null : tables.style);
      if (table === "llm_prompt_templates") return chain(tables.templates ?? []);
      throw new Error(`unexpected table: ${table}`);
    },
  } as never;
}

const USER = "user-1";
const PROJECT = "proj-1";

const PROJECT_ROW = {
  name: "都市逆袭",
  genre: "都市/悬疑",
  serialization_mode: "continuous",
  generation_config: {
    character_count: { min: 4, max: 9 },
    location_count: { min: 3, max: 8 },
    episode_count: { min: 3, max: 10 },
    scenes_per_episode: { min: 2, max: 6 },
    shots_per_scene: { min: 3, max: 7 },
  },
  visual_style_id: "style-1",
};

describe("getActiveNodeTemplate — 五级 fallback", () => {
  it("第 1 级：用户级模式精确行生效", async () => {
    const supabase = makeMockSupabase({
      project: PROJECT_ROW,
      templates: [
        { user_id: USER, serialization_mode: "continuous", system_rule: "用户-连续", version_number: 2, source: "user" },
        { user_id: USER, serialization_mode: null, system_rule: "用户-通用", version_number: 1, source: "user" },
        { user_id: null, serialization_mode: "continuous", system_rule: "系统-连续", version_number: 1, source: "system" },
        { user_id: null, serialization_mode: null, system_rule: "系统-通用", version_number: 1, source: "system" },
      ],
    });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "script");
    expect(result.systemRule).toBe("用户-连续");
    expect(result.source).toBe("user");
    expect(result.versionNumber).toBe(2);
  });

  it("第 2 级：用户级通用行生效（无模式精确行）", async () => {
    const supabase = makeMockSupabase({
      project: PROJECT_ROW,
      templates: [
        { user_id: USER, serialization_mode: null, system_rule: "用户-通用", version_number: 3, source: "user" },
        { user_id: null, serialization_mode: "continuous", system_rule: "系统-连续", version_number: 1, source: "system" },
      ],
    });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "script");
    expect(result.systemRule).toBe("用户-通用");
    expect(result.source).toBe("user");
    expect(result.versionNumber).toBe(3);
  });

  it("第 3 级：系统级模式精确行生效", async () => {
    const supabase = makeMockSupabase({
      project: PROJECT_ROW,
      templates: [
        { user_id: null, serialization_mode: "continuous", system_rule: "系统-连续", version_number: 1, source: "system" },
        { user_id: null, serialization_mode: null, system_rule: "系统-通用", version_number: 1, source: "system" },
      ],
    });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "episode_plot");
    expect(result.systemRule).toBe("系统-连续");
    expect(result.source).toBe("system");
  });

  it("第 4 级：系统级通用行生效", async () => {
    const supabase = makeMockSupabase({
      project: PROJECT_ROW,
      templates: [{ user_id: null, serialization_mode: null, system_rule: "系统-通用", version_number: 1, source: "system" }],
    });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "character");
    expect(result.systemRule).toBe("系统-通用");
    expect(result.source).toBe("system");
  });

  it("第 5 级：DB 全空时代码内置兜底", async () => {
    const supabase = makeMockSupabase({ project: PROJECT_ROW, templates: [] });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "style");
    expect(result.source).toBe("builtin");
    expect(result.versionNumber).toBeNull();
    expect(result.systemRule).toContain("视觉风格设计师");
  });

  it("非 modeAware 节点忽略模式专属行", async () => {
    const supabase = makeMockSupabase({
      project: PROJECT_ROW,
      templates: [
        { user_id: USER, serialization_mode: "continuous", system_rule: "用户-连续(不应生效)", version_number: 1, source: "user" },
        { user_id: null, serialization_mode: null, system_rule: "系统-通用", version_number: 1, source: "system" },
      ],
    });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "character"); // modeAware=false
    expect(result.systemRule).toBe("系统-通用");
  });

  it("modeAware 节点但项目无 serialization_mode → 回退 continuous 匹配（与 episode-plot 行为一致）", async () => {
    const supabase = makeMockSupabase({
      project: { ...PROJECT_ROW, serialization_mode: null },
      templates: [
        { user_id: null, serialization_mode: "continuous", system_rule: "系统-连续", version_number: 1, source: "system" },
        { user_id: null, serialization_mode: null, system_rule: "系统-通用", version_number: 1, source: "system" },
      ],
    });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "script");
    expect(result.systemRule).toBe("系统-连续");
  });
});

describe("getActiveNodeTemplate — 变量组装", () => {
  it("A 类数量变量来自 generation_config，B 类来自项目上下文", async () => {
    const supabase = makeMockSupabase({
      project: PROJECT_ROW,
      story: { raw_input: "被背叛的女主重返家族" },
      style: { name: "电影感都市风", fixed_prompt: "cinematic shot" },
      templates: [],
    });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "character", { episodeNumber: 5 });

    expect(result.variables.character_count_min).toBe(4);
    expect(result.variables.character_count_max).toBe(9);
    expect(result.variables.shots_per_scene_min).toBe(3);
    expect(result.variables.project_name).toBe("都市逆袭");
    expect(result.variables.genre).toBe("都市/悬疑");
    expect(result.variables.synopsis).toBe("被背叛的女主重返家族");
    expect(result.variables.style_name).toBe("电影感都市风");
    expect(result.variables.style_fixed_prompt).toBe("cinematic shot");
    expect(result.variables.episode_number).toBe(5);
    expect(String(result.variables.serialization_mode_label)).toContain("连续剧情");
  });

  it("项目缺配置时 A 类变量回退默认值，缺失上下文为空串", async () => {
    const supabase = makeMockSupabase({
      project: { name: "P", genre: null, serialization_mode: null, generation_config: null, visual_style_id: null },
      story: null,
      style: null,
      templates: [],
    });
    const result = await getActiveNodeTemplate(supabase, USER, PROJECT, "character");

    expect(result.variables.character_count_min).toBe(DEFAULT_GENERATION_CONFIG.character_count.min);
    expect(result.variables.synopsis).toBe("");
    expect(result.variables.style_name).toBe("");
    expect(result.variables.serialization_mode_label).toContain("连续剧情"); // 无模式时默认 continuous 文案
  });

  it("未知 node_key 抛错", async () => {
    const supabase = makeMockSupabase({});
    await expect(getActiveNodeTemplate(supabase, USER, PROJECT, "bad_key")).rejects.toThrow();
  });
});
