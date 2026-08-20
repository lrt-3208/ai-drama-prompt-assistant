import { describe, expect, it } from "vitest";
import { NODE_REGISTRY, getNodeDef, NODE_KEYS } from "@/lib/ai/node-registry";
import { extractVariables } from "@/lib/ai/template-renderer";

const EXPECTED_KEYS = [
  "story",
  "character",
  "location",
  "style",
  "script",
  "storyboard",
  "storyboard_episode",
  "episode_plot",
  "shot_outline",
  "storyboard_document",
  "asset_optimize_character",
  "asset_optimize_location",
  "asset_optimize_style",
  "visual_specs",
  "evaluate_prompt",
];

const MODE_AWARE_KEYS = ["script", "storyboard", "storyboard_episode", "episode_plot", "shot_outline"];

describe("node-registry", () => {
  it("包含全部 15 个节点，无多余", () => {
    expect(NODE_KEYS.sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(Object.keys(NODE_REGISTRY)).toHaveLength(15);
  });

  it("modeAware 标记正确（5 个连载模式感知节点）", () => {
    for (const key of NODE_KEYS) {
      expect(NODE_REGISTRY[key].modeAware).toBe(MODE_AWARE_KEYS.includes(key));
    }
  });

  it("每个节点元信息完整（label/description 非空）", () => {
    for (const def of Object.values(NODE_REGISTRY)) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("模板正文非空且包含 JSON 输出结构说明", () => {
    for (const def of Object.values(NODE_REGISTRY)) {
      expect(def.defaultSystemRule.trim().length).toBeGreaterThan(100);
      expect(def.defaultSystemRule).toMatch(/JSON/);
    }
  });

  it("模板中引用的每个 &变量 都在该节点 variables 中声明", () => {
    for (const def of Object.values(NODE_REGISTRY)) {
      const declared = new Set(def.variables.map((v) => v.name));
      for (const used of extractVariables(def.defaultSystemRule)) {
        expect(declared.has(used), `${def.key} 模板引用了未声明的变量 &${used}`).toBe(true);
      }
    }
  });

  it("数量变量节点的模板包含其声明的全部 A 类变量", () => {
    const expectations: Record<string, string[]> = {
      character: ["character_count_min", "character_count_max"],
      location: ["location_count_min", "location_count_max"],
      script: ["episode_count_min", "episode_count_max"],
      storyboard: [
        "episode_count_min",
        "episode_count_max",
        "scenes_per_episode_min",
        "scenes_per_episode_max",
        "shots_per_scene_min",
        "shots_per_scene_max",
      ],
      storyboard_episode: [
        "scenes_per_episode_min",
        "scenes_per_episode_max",
        "shots_per_scene_min",
        "shots_per_scene_max",
      ],
      shot_outline: [
        "scenes_per_episode_min",
        "scenes_per_episode_max",
        "shots_per_scene_min",
        "shots_per_scene_max",
      ],
    };
    for (const [key, vars] of Object.entries(expectations)) {
      const rule = NODE_REGISTRY[key].defaultSystemRule;
      for (const v of vars) {
        expect(rule.includes(`&${v}`), `${key} 模板缺少 &${v}`).toBe(true);
      }
    }
  });

  it("每个节点声明全部 7 个 B 类项目元信息变量", () => {
    const bVars = [
      "project_name",
      "genre",
      "synopsis",
      "serialization_mode_label",
      "style_name",
      "style_fixed_prompt",
      "episode_number",
    ];
    for (const def of Object.values(NODE_REGISTRY)) {
      const names = def.variables.map((v) => v.name);
      for (const b of bVars) {
        expect(names.includes(b), `${def.key} 缺少 B 类变量 ${b}`).toBe(true);
      }
    }
  });

  it("getNodeDef 正常返回，未知 key 返回 undefined", () => {
    expect(getNodeDef("character")?.key).toBe("character");
    expect(getNodeDef("not_exist")).toBeUndefined();
  });
});
