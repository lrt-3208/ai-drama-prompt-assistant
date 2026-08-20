import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/ai/template-renderer";

describe("renderTemplate", () => {
  it("替换已提供的变量（字符串与数字值）", () => {
    const result = renderTemplate(
      "生成 &character_count_min-&character_count_max 个角色，风格：&project_name",
      { character_count_min: 3, character_count_max: 5, project_name: "都市逆袭" }
    );
    expect(result.text).toBe("生成 3-5 个角色，风格：都市逆袭");
    expect(result.unresolved).toEqual([]);
  });

  it("未识别变量保留原文并记入 unresolved", () => {
    const result = renderTemplate("生成 &unknown_var 个角色", { character_count_min: 3 });
    expect(result.text).toBe("生成 &unknown_var 个角色");
    expect(result.unresolved).toEqual(["unknown_var"]);
  });

  it("同一未识别变量出现多次时 unresolved 去重", () => {
    const result = renderTemplate("&foo 和 &foo", {});
    expect(result.text).toBe("&foo 和 &foo");
    expect(result.unresolved).toEqual(["foo"]);
  });

  it("& 后跟非小写字母开头的内容不视为变量（AT&T、URL 等安全）", () => {
    const result = renderTemplate("AT&T 与 https://a.com?x=1&Y=2 保持原样", {});
    expect(result.text).toBe("AT&T 与 https://a.com?x=1&Y=2 保持原样");
    expect(result.unresolved).toEqual([]);
  });

  it("变量名只含小写字母/数字/下划线，大写开头不匹配", () => {
    const result = renderTemplate("&BadName &good_name", { good_name: "好" });
    expect(result.text).toBe("&BadName 好");
    expect(result.unresolved).toEqual([]);
  });

  it("空变量表收集全部变量名", () => {
    const result = renderTemplate("&a &b &a", {});
    expect(result.unresolved).toEqual(["a", "b"]);
  });

  it("变量值为空字符串时执行替换（值为已定义）", () => {
    const result = renderTemplate("[&style_fixed_prompt]", { style_fixed_prompt: "" });
    expect(result.text).toBe("[]");
    expect(result.unresolved).toEqual([]);
  });

  it("无变量的模板原样返回", () => {
    const result = renderTemplate("你是一位专业的短剧编剧。", {});
    expect(result.text).toBe("你是一位专业的短剧编剧。");
    expect(result.unresolved).toEqual([]);
  });
});
