// ============================================
// 模板渲染器 — &变量 引用语法
// 语法：&name（name = 小写字母开头，后接小写字母/数字/下划线）
// 未识别的变量保留原文，并收集到 unresolved 供调用方告警
// ============================================

/** 变量引用语法：& 后跟小写字母开头的小写字母/数字/下划线串（AT&T、URL 中的 &Y 等不受影响） */
const VARIABLE_PATTERN = /&([a-z][a-z0-9_]*)/g;

export interface RenderResult {
  /** 渲染后的完整文本 */
  text: string;
  /** 模板中出现但未提供值的变量名（去重） */
  unresolved: string[];
}

/**
 * 将模板中的 &变量 引用替换为实际值。
 * - 变量值支持 string | number
 * - 值为空字符串时视为已定义，执行替换
 * - 未定义的变量保留 &name 原文，并记入 unresolved
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | number>
): RenderResult {
  const unresolved = new Set<string>();
  const text = template.replace(VARIABLE_PATTERN, (full, name: string) => {
    if (name in variables) {
      return String(variables[name]);
    }
    unresolved.add(name);
    return full;
  });
  return { text, unresolved: Array.from(unresolved) };
}

/** 提取模板中引用的全部变量名（去重） */
export function extractVariables(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    names.add(match[1]);
  }
  return Array.from(names);
}
