"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import {
  NODE_REGISTRY,
  NODE_KEYS,
  getNodeDef,
  type NodeDef,
} from "@/lib/ai/node-registry";
import { extractVariables } from "@/lib/ai/template-renderer";

// Monaco 体积较大，仅本页动态加载
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[480px] items-center justify-center text-sm text-muted-foreground">
      编辑器加载中…
    </div>
  ),
});

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

/** 连载模式子项（modeAware 节点展开） */
const MODE_OPTIONS = [
  { value: "generic", label: "通用" },
  { value: "continuous", label: "连续剧情" },
  { value: "episodic", label: "单元剧" },
  { value: "mixed", label: "混合" },
] as const;

interface ActiveTemplate {
  system_rule: string;
  source: "user" | "system" | "builtin";
  version_number: number | null;
  is_user_overridden: boolean;
  inherited: boolean;
}

interface HistoryRow {
  id: string;
  version_number: number;
  is_current: boolean;
  created_at: string;
  summary: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

const SOURCE_LABELS: Record<ActiveTemplate["source"], string> = {
  user: "我的配置",
  system: "系统默认",
  builtin: "内置兜底",
};

function modeLabel(mode: string): string {
  return MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode;
}

export function PromptTemplateManager() {
  const [nodeKey, setNodeKey] = useState<string>(NODE_KEYS[0]);
  const [mode, setMode] = useState<string>("generic");

  const [tpl, setTpl] = useState<ActiveTemplate | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // 预览渲染（Task 14）
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewUnresolved, setPreviewUnresolved] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [previewProjectId, setPreviewProjectId] = useState("");

  // 版本历史（Task 14）
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [rollbackId, setRollbackId] = useState<string | null>(null);

  const def = getNodeDef(nodeKey) as NodeDef;
  const effectiveMode = def.modeAware ? mode : "generic";
  const dirty = tpl ? draft !== tpl.system_rule : false;

  // 未识别变量（draft 中出现但节点未声明的 &变量）
  const unknownVars = useMemo(() => {
    const known = new Set(def.variables.map((v) => v.name));
    return extractVariables(draft).filter((n) => !known.has(n));
  }, [draft, def]);

  // Monaco 实例与补全 provider（provider 只注册一次，变量清单经 ref 跟随节点切换）
  const editorRef = useRef<EditorInstance | null>(null);
  const nodeVarsRef = useRef(def.variables);
  useEffect(() => {
    nodeVarsRef.current = getNodeDef(nodeKey)?.variables ?? [];
  }, [nodeKey]);

  const fetchTemplate = useCallback(async (): Promise<ActiveTemplate | null> => {
    try {
      const res = await fetch(
        `/api/prompt-templates?node_key=${encodeURIComponent(nodeKey)}&mode=${effectiveMode}`
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "加载失败");
        return null;
      }
      return data.data as ActiveTemplate;
    } catch {
      toast.error("网络错误");
      return null;
    }
  }, [nodeKey, effectiveMode]);

  useEffect(() => {
    let active = true;
    (async () => {
      const t = await fetchTemplate();
      if (!active) return;
      setTpl(t);
      setDraft(t?.system_rule ?? "");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [fetchTemplate]);

  /** 拉取并应用生效模板（事件处理器上下文中调用） */
  const refreshTemplate = useCallback(async () => {
    const t = await fetchTemplate();
    setTpl(t);
    setDraft(t?.system_rule ?? "");
  }, [fetchTemplate]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monaco.languages.registerCompletionItemProvider("plaintext", {
      triggerCharacters: ["&"],
      provideCompletionItems: (
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position
      ) => {
        // 取光标前行内最近的 &，以其后已输入的合法前缀过滤补全项
        const lineText = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const ampIndex = lineText.lastIndexOf("&");
        if (ampIndex === -1) return { suggestions: [] };
        const typed = lineText.slice(ampIndex + 1);
        if (typed && !/^[a-z][a-z0-9_]*$/.test(typed)) return { suggestions: [] };
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: ampIndex + 1, // 覆盖 "&已输入前缀"，插入完整 "&name"
          endColumn: position.column,
        };
        const suggestions = nodeVarsRef.current.map((v) => ({
          label: `&${v.name}`,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `&${v.name}`,
          detail: v.description,
          documentation: `示例：${v.example}`,
          range,
        }));
        return { suggestions };
      },
    });
  };

  const insertVariable = (name: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    const position = editor.getPosition();
    // 光标处插入 &name（有选区则替换选区）
    const range =
      selection ??
      (position
        ? {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          }
        : { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 });
    editor.executeEdits("insert-variable", [{ range, text: `&${name}` }]);
    editor.focus();
  };

  const handleSave = async () => {
    if (!tpl || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prompt-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_key: nodeKey,
          serialization_mode: effectiveMode === "generic" ? null : effectiveMode,
          system_rule: draft,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "保存失败");
        return;
      }
      toast.success(`已保存为新版本 v${data.data.version_number}`);
      await refreshTemplate();
    } catch {
      toast.error("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setConfirmResetOpen(false);
    try {
      const res = await fetch(
        `/api/prompt-templates?node_key=${encodeURIComponent(nodeKey)}&mode=${effectiveMode}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "恢复失败");
        return;
      }
      toast.success("已恢复系统默认");
      await refreshTemplate();
    } catch {
      toast.error("网络错误");
    }
  };

  // ---------- 预览渲染 ----------
  const openPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewText("");
    setPreviewUnresolved([]);
    try {
      // 项目列表：默认最近更新的项目
      if (projects.length === 0) {
        const projRes = await fetch("/api/projects");
        const projData = await projRes.json();
        if (projRes.ok) {
          setProjects(projData.data || []);
          setPreviewProjectId((prev) => prev || projData.data?.[0]?.id || "");
        }
      }
      const projectId = previewProjectId || projects[0]?.id;
      if (!projectId) {
        toast.error("请先创建一个项目再预览");
        setPreviewLoading(false);
        return;
      }
      const res = await fetch("/api/prompt-templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_key: nodeKey, system_rule: draft, project_id: projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "预览失败");
        return;
      }
      setPreviewText(data.data.text);
      setPreviewUnresolved(data.data.unresolved || []);
    } catch {
      toast.error("网络错误");
    } finally {
      setPreviewLoading(false);
    }
  };

  const runPreview = async (projectId: string) => {
    setPreviewProjectId(projectId);
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/prompt-templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_key: nodeKey, system_rule: draft, project_id: projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "预览失败");
        return;
      }
      setPreviewText(data.data.text);
      setPreviewUnresolved(data.data.unresolved || []);
    } catch {
      toast.error("网络错误");
    } finally {
      setPreviewLoading(false);
    }
  };

  // ---------- 版本历史 ----------
  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setRollbackId(null);
    try {
      const res = await fetch(
        `/api/prompt-templates?node_key=${encodeURIComponent(nodeKey)}&mode=${effectiveMode}&history=1`
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "加载历史失败");
        return;
      }
      setHistoryRows(data.data || []);
    } catch {
      toast.error("网络错误");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleRollback = async () => {
    if (!rollbackId) return;
    try {
      const res = await fetch("/api/prompt-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_key: nodeKey, version_id: rollbackId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "回滚失败");
        return;
      }
      toast.success("已回滚到所选版本");
      setHistoryOpen(false);
      await refreshTemplate();
    } catch {
      toast.error("网络错误");
    }
  };

  // ---------- 渲染 ----------
  return (
    <div className="flex gap-6">
      {/* 左侧：节点列表 */}
      <Card className="w-60 shrink-0 self-start">
        <CardContent className="p-2">
          {NODE_KEYS.map((key) => {
            const nodeDef = NODE_REGISTRY[key];
            const isActive = key === nodeKey;
            return (
              <div key={key}>
                <button
                  onClick={() => {
                    setNodeKey(key);
                    setMode("generic");
                  }}
                  className={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                    isActive && effectiveMode === "generic"
                      ? "bg-accent font-medium text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                >
                  {nodeDef.label}
                  {nodeDef.modeAware && (
                    <span className="ml-1 text-xs text-muted-foreground">（分模式）</span>
                  )}
                </button>
                {nodeDef.modeAware && isActive &&
                  MODE_OPTIONS.filter((m) => m.value !== "generic").map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setMode(m.value)}
                      className={`w-full rounded-md px-3 py-1 pl-6 text-left text-sm transition-colors ${
                        mode === m.value
                          ? "bg-accent font-medium text-accent-foreground"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 右侧：状态条 + 编辑器 + 变量侧栏 */}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{def.label}</span>
          {effectiveMode !== "generic" && (
            <Badge variant="outline">{modeLabel(effectiveMode)}</Badge>
          )}
          {tpl && (
            <Badge variant={tpl.source === "user" ? "default" : "secondary"}>
              {SOURCE_LABELS[tpl.source]}
              {tpl.version_number !== null && ` v${tpl.version_number}`}
            </Badge>
          )}
          {tpl?.inherited && (
            <Badge variant="outline" className="text-amber-600">
              继承自通用配置
            </Badge>
          )}
          {dirty && (
            <span className="text-xs text-amber-600">未保存的修改</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? "保存中…" : "保存"}
            </Button>
            <Button size="sm" variant="outline" onClick={openPreview}>
              预览渲染
            </Button>
            <Button size="sm" variant="outline" onClick={openHistory}>
              版本历史
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!tpl?.is_user_overridden}
              onClick={() => setConfirmResetOpen(true)}
            >
              恢复默认
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{def.description}</p>

        {unknownVars.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            未识别变量（渲染时将保留原文）：{unknownVars.map((n) => `&${n}`).join("、")}
          </div>
        )}

        <div className="flex gap-4">
          <div className="min-w-0 flex-1 overflow-hidden rounded-md border">
            {loading ? (
              <div className="flex h-[480px] items-center justify-center text-sm text-muted-foreground">
                加载中…
              </div>
            ) : (
              <MonacoEditor
                height="480px"
                defaultLanguage="plaintext"
                value={draft}
                onChange={(v) => setDraft(v ?? "")}
                onMount={handleEditorMount}
                theme="vs"
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "on",
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
                loading={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    编辑器加载中…
                  </div>
                }
              />
            )}
          </div>

          {/* 变量侧栏 */}
          <Card className="w-64 shrink-0 self-start">
            <CardContent className="max-h-[520px] space-y-1 overflow-y-auto p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                可用变量（点击插入，模板中用 &name 引用）
              </p>
              {def.variables.map((v) => (
                <button
                  key={v.name}
                  onClick={() => insertVariable(v.name)}
                  className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
                >
                  <code className="text-xs font-semibold text-primary">&amp;{v.name}</code>
                  <p className="text-xs text-muted-foreground">{v.description}</p>
                  <p className="truncate text-xs text-muted-foreground/70">示例：{v.example}</p>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 恢复默认确认 */}
      <ConfirmDialog
        open={confirmResetOpen}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={handleReset}
        title="恢复系统默认"
        description="将删除你在该节点（及所选模式）下的全部自定义版本，恢复为系统默认模板。此操作不可撤销。"
        confirmText="恢复默认"
        variant="destructive"
      />

      {/* 预览渲染 Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>预览渲染 — {def.label}</DialogTitle>
            <DialogDescription>
              选择一个项目，用其实际配置渲染模板变量，查看最终发送给 AI 的 system prompt。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">项目：</span>
            <select
              className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
              value={previewProjectId}
              onChange={(e) => runPreview(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {previewUnresolved.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              未识别变量：{previewUnresolved.map((n) => `&${n}`).join("、")}
            </div>
          )}
          <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
            {previewLoading ? "渲染中…" : previewText}
          </pre>
        </DialogContent>
      </Dialog>

      {/* 版本历史 Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              版本历史 — {def.label}
              {effectiveMode !== "generic" ? ` · ${modeLabel(effectiveMode)}` : ""}
            </DialogTitle>
            <DialogDescription>选择一个版本回滚（回滚后其余版本保留，可再次回滚）。</DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
          ) : historyRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              该维度还没有自定义版本。保存一次模板后会在这里生成历史记录。
            </div>
          ) : (
            <div className="max-h-[420px] space-y-1 overflow-y-auto">
              {historyRows.map((row) => (
                <label
                  key={row.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
                    rollbackId === row.id ? "border-primary bg-accent/50" : "hover:bg-accent/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="rollback-version"
                    className="mt-1"
                    checked={rollbackId === row.id}
                    onChange={() => setRollbackId(row.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">v{row.version_number}</span>
                      {row.is_current && <Badge variant="secondary">当前</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{row.summary}…</p>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={!rollbackId} onClick={handleRollback}>
              回滚到所选版本
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
