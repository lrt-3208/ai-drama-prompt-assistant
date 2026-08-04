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
}

const emptyChar: Record<string, string> = {
  name: "", role: "", age: "", gender: "", appearance: "", personality: "", background: "", clothing: "", fixed_prompt: ""
};

function roleVariant(role: string | null) {
  if (role === "主角") return "default" as const;
  if (role === "反派") return "destructive" as const;
  return "secondary" as const;
}

export function CharacterList({ projectId, initial, activeTask }: { projectId: string; initial: Character[]; activeTask?: ActiveTask | null }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Character | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyChar);
  const [loading, setLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

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
                  {c.role && <Badge variant={roleVariant(c.role)}>{c.role}</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{c.fixed_prompt}</p>
                <div className="flex gap-2 flex-wrap">
                  {c.gender && <span className="text-xs text-muted-foreground">{c.gender}</span>}
                  {c.age && <span className="text-xs text-muted-foreground">{c.age}岁</span>}
                </div>
                <Button variant="ghost" size="sm" className="text-destructive mt-2" onClick={e => { e.stopPropagation(); handleDelete(c.id); }}>删除</Button>
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
