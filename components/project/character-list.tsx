"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTaskPolling, type ActiveTask } from "@/hooks/use-task-polling";
import { ImageUploader } from "@/components/assets/image-uploader";

interface Character {
  id: string;
  name: string;
  role: string | null;
  age: number | null;
  gender: string | null;
  appearance: string | null;
  personality: string | null;
  background: string | null;
  clothing: string | null;
  fixed_prompt: string;
  portrait_asset_id: string | null;
  stable_key: string;
  is_locked: boolean;
}

const emptyChar: Record<string, string> = {
  name: "", role: "", age: "", gender: "", appearance: "", personality: "", background: "", clothing: "", fixed_prompt: ""
};

function roleVariant(role: string | null) {
  if (role === "主角") return "default" as const;
  if (role === "反派") return "destructive" as const;
  return "secondary" as const;
}

export function CharacterList({ projectId, initial, activeTask, assetUrls = {}, versionMap = {} }: { projectId: string; initial: Character[]; activeTask?: ActiveTask | null; assetUrls?: Record<string, string>; versionMap?: Record<string, number> }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Character | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyChar);
  const [loading, setLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [specsOpen, setSpecsOpen] = useState<string | null>(null);
  const [specsMap, setSpecsMap] = useState<Map<string, Array<{ spec_type: string; spec_name: string; spec_prompt: string }>>>(new Map());
  const [genSpecsLoading, setGenSpecsLoading] = useState(false);

  const { isGenerating, createTask } = useTaskPolling({
    projectId,
    initialTask: activeTask,
    onDone: (status) => {
      if (status === "success") toast.success("角色生成完成");
      else toast.error("角色生成失败");
      router.refresh();
    },
  });

  // Sync when initial changes (after router.refresh() or AI generation)
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setList(initial);
  }

  const handleShowSpecs = async (charId: string) => {
    if (specsOpen === charId) {
      setSpecsOpen(null);
      return;
    }
    setSpecsOpen(charId);
    if (!specsMap.has(charId)) {
      try {
        const res = await fetch(`/api/projects/${projectId}/characters/${charId}/visual-specs`);
        if (res.ok) {
          const data = await res.json();
          const newMap = new Map(specsMap);
          newMap.set(charId, data.specs || []);
          setSpecsMap(newMap);
        }
      } catch {
        // ignore
      }
    }
  };

  const handleGenSpecs = async (charId: string) => {
    setGenSpecsLoading(true);
    toast.info("正在生成视觉规范...");
    try {
      const res = await fetch(`/api/projects/${projectId}/characters/${charId}/visual-specs`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      const newMap = new Map(specsMap);
      newMap.set(charId, data.specs || []);
      setSpecsMap(newMap);
      toast.success("视觉规范生成完成");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenSpecsLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyChar);
    setOpen(true);
  };

  const openEdit = (c: Character) => {
    setEditing(c);
    setForm({
      name: c.name, role: c.role || "", age: c.age?.toString() || "", gender: c.gender || "",
      appearance: c.appearance || "", personality: c.personality || "", background: c.background || "",
      clothing: c.clothing || "", fixed_prompt: c.fixed_prompt
    });
    setOpen(true);
  };

  const handleGenerate = async () => {
    const confirmed = window.confirm(
      "AI 将重新生成角色，已有角色会被更新或新增，AI 不会删除你的角色，是否继续？"
    );
    if (!confirmed) return;

    try {
      await createTask("regenerate_characters", { customPrompt: aiPrompt || undefined });
      setAiPrompt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.fixed_prompt.trim()) {
      toast.error("名称和固定 Prompt 不能为空");
      return;
    }
    setLoading(true);

    const url = editing
      ? `/api/projects/${projectId}/characters/${editing.id}`
      : `/api/projects/${projectId}/characters`;
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, age: form.age ? parseInt(form.age) : null }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) { toast.error(data.error || "操作失败"); return; }

    if (editing) {
      setList(list.map(c => c.id === editing.id ? data.data : c));
      toast.success("已更新");
    } else {
      setList([...list, data.data]);
      toast.success("已创建");
    }
    setOpen(false);
  };

  const handleToggleLock = async (c: Character) => {
    const res = await fetch(`/api/projects/${projectId}/characters/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: !c.is_locked }),
    });
    if (res.ok) {
      setList(list.map(item => item.id === c.id ? { ...item, is_locked: !c.is_locked } : item));
      toast.success(c.is_locked ? "已解锁" : "已锁定（AI 重新生成时不会覆盖此角色）");
    } else {
      toast.error("操作失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此角色？")) return;
    const res = await fetch(`/api/projects/${projectId}/characters/${id}`, { method: "DELETE" });
    if (res.ok) {
      setList(list.filter(c => c.id !== id));
      toast.success("已删除");
    } else {
      toast.error("删除失败");
    }
  };

  const field = (key: string, label: string, multiline = false) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={key}>{label}</Label>
      {multiline ? (
        <Textarea id={key} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} rows={3} />
      ) : (
        <Input id={key} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 生成角色</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            placeholder="输入你的要求（可选）... 如：增加一个隐藏身份的反派角色"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={3}
            disabled={isGenerating}
          />
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="self-start"
          >
            {isGenerating ? "AI 生成中..." : "AI 生成角色"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">角色资产</h2>
        <Button variant="outline" onClick={openCreate}>手动新增</Button>
      </div>

      {list.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">还没有角色，点击上方 AI 生成或手动新增</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map(c => (
            <Card key={c.id} className="cursor-pointer hover:bg-accent/50" onClick={() => openEdit(c)}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <div className="flex items-center gap-1">
                    {c.is_locked && <Badge variant="outline" className="text-xs">🔒 已锁定</Badge>}
                    {c.role && <Badge variant={roleVariant(c.role)}>{c.role}</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3" onClick={e => e.stopPropagation()}>
                  <ImageUploader
                    projectId={projectId}
                    entityType="character"
                    entityId={c.id}
                    assetType="character_portrait"
                    assetId={c.portrait_asset_id}
                    url={c.portrait_asset_id ? assetUrls[c.portrait_asset_id] : null}
                    hint="上传角色定妆照"
                    onUploaded={(assetId) => setList(list.map(item => item.id === c.id ? { ...item, portrait_asset_id: assetId } : item))}
                    onDeleted={() => setList(list.map(item => item.id === c.id ? { ...item, portrait_asset_id: null } : item))}
                  />
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs text-muted-foreground font-mono">{c.stable_key}</p>
                  {versionMap[c.id] && <Badge variant="outline" className="text-[10px] h-4 px-1">v{versionMap[c.id]}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{c.fixed_prompt}</p>
                <div className="flex gap-2 flex-wrap">
                  {c.gender && <span className="text-xs text-muted-foreground">{c.gender}</span>}
                  {c.age && <span className="text-xs text-muted-foreground">{c.age}岁</span>}
                </div>
                <div className="flex gap-2 mt-2">
                  <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); handleToggleLock(c); }}>
                    {c.is_locked ? "🔓 解锁" : "🔒 锁定"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); handleShowSpecs(c.id); }}>
                    {specsOpen === c.id ? "收起规范" : "视觉规范"}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={e => { e.stopPropagation(); handleDelete(c.id); }}>删除</Button>
                </div>

                {/* 视觉规范展示 */}
                {specsOpen === c.id && (
                  <div className="mt-3 rounded-lg bg-muted/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">视觉规范（4 类）</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={genSpecsLoading}
                        onClick={e => { e.stopPropagation(); handleGenSpecs(c.id); }}
                      >
                        {genSpecsLoading ? "生成中..." : "AI 生成"}
                      </Button>
                    </div>
                    {(specsMap.get(c.id) || []).length > 0 ? (
                      <div className="space-y-2">
                        {(specsMap.get(c.id) || []).map((spec, i) => (
                          <div key={i} className="text-xs">
                            <Badge variant="outline" className="mb-1">{spec.spec_name}</Badge>
                            <p className="text-muted-foreground font-mono">{spec.spec_prompt}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">尚未生成视觉规范，点击 &ldquo;AI 生成&rdquo;</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "编辑角色" : "新增角色"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
            {field("name", "名称")}
            {field("role", "角色类型（主角/配角/反派）")}
            {field("gender", "性别")}
            {field("age", "年龄")}
            {field("appearance", "外貌描述", true)}
            {field("personality", "性格", true)}
            {field("background", "背景", true)}
            {field("clothing", "服装", true)}
            <div className="sm:col-span-2">{field("fixed_prompt", "固定视觉 Prompt（一致性锁定）", true)}</div>
            <div className="sm:col-span-2"><Button type="submit" disabled={loading}>{loading ? "保存中..." : "保存"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
