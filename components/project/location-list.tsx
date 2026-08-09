"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTaskPolling, type ActiveTask } from "@/hooks/use-task-polling";
import { ImageUploader } from "@/components/assets/image-uploader";

interface Location {
  id: string;
  name: string;
  description: string | null;
  environment: string | null;
  time: string | null;
  weather: string | null;
  color_style: string | null;
  fixed_prompt: string;
  reference_asset_id: string | null;
}

const emptyLoc: Record<string, string> = { name: "", description: "", environment: "", time: "", weather: "", color_style: "", fixed_prompt: "" };

export function LocationList({ projectId, initial, activeTask, assetUrls = {} }: { projectId: string; initial: Location[]; activeTask?: ActiveTask | null; assetUrls?: Record<string, string> }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyLoc);
  const [loading, setLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  const { isGenerating, createTask } = useTaskPolling({
    projectId,
    initialTask: activeTask,
    onDone: (status) => {
      if (status === "success") toast.success("场景生成完成");
      else toast.error("场景生成失败");
      router.refresh();
    },
  });

  // Sync when initial changes (after router.refresh() or AI generation)
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setList(initial);
  }

  const openCreate = () => { setEditing(null); setForm(emptyLoc); setOpen(true); };
  const openEdit = (l: Location) => {
    setEditing(l);
    setForm({ name: l.name, description: l.description || "", environment: l.environment || "", time: l.time || "", weather: l.weather || "", color_style: l.color_style || "", fixed_prompt: l.fixed_prompt });
    setOpen(true);
  };

  const handleGenerate = async () => {
    const confirmed = window.confirm(
      "AI 将重新生成场景，已有场景会被更新或新增，AI 不会删除你的场景，是否继续？"
    );
    if (!confirmed) return;

    try {
      await createTask("regenerate_locations", { customPrompt: aiPrompt || undefined });
      setAiPrompt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.fixed_prompt.trim()) { toast.error("名称和固定 Prompt 不能为空"); return; }
    setLoading(true);
    const url = editing ? `/api/projects/${projectId}/locations/${editing.id}` : `/api/projects/${projectId}/locations`;
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error || "操作失败"); return; }
    if (editing) { setList(list.map(l => l.id === editing.id ? data.data : l)); toast.success("已更新"); }
    else { setList([...list, data.data]); toast.success("已创建"); }
    setOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除此场景？")) return;
    const res = await fetch(`/api/projects/${projectId}/locations/${id}`, { method: "DELETE" });
    if (res.ok) { setList(list.filter(l => l.id !== id)); toast.success("已删除"); }
    else { toast.error("删除失败"); }
  };

  const field = (key: string, label: string, multiline = false) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={key}>{label}</Label>
      {multiline ? <Textarea id={key} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} rows={3} />
        : <Input id={key} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 生成场景</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            placeholder="输入你的要求（可选）... 如：增加一个雨夜的神秘街角场景"
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
            {isGenerating ? "AI 生成中..." : "AI 生成场景"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">场景资产</h2>
        <Button variant="outline" onClick={openCreate}>手动新增</Button>
      </div>

      {list.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">还没有场景，点击上方 AI 生成或手动新增</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map(l => (
            <Card key={l.id} className="cursor-pointer hover:bg-accent/50" onClick={() => openEdit(l)}>
              <CardHeader><CardTitle className="text-base">{l.name}</CardTitle></CardHeader>
              <CardContent>
                <div className="mb-3" onClick={e => e.stopPropagation()}>
                  <ImageUploader
                    projectId={projectId}
                    entityType="location"
                    entityId={l.id}
                    assetType="location_reference"
                    assetId={l.reference_asset_id}
                    url={l.reference_asset_id ? assetUrls[l.reference_asset_id] : null}
                    hint="上传场景参考图"
                    onUploaded={(assetId) => setList(list.map(item => item.id === l.id ? { ...item, reference_asset_id: assetId } : item))}
                    onDeleted={() => setList(list.map(item => item.id === l.id ? { ...item, reference_asset_id: null } : item))}
                  />
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{l.fixed_prompt}</p>
                <div className="flex gap-2 flex-wrap">
                  {l.time && <span className="text-xs text-muted-foreground">{l.time}</span>}
                  {l.weather && <span className="text-xs text-muted-foreground">{l.weather}</span>}
                  {l.color_style && <span className="text-xs text-muted-foreground">{l.color_style}</span>}
                </div>
                <Button variant="ghost" size="sm" className="text-destructive mt-2" onClick={e => { e.stopPropagation(); handleDelete(l.id); }}>删除</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "编辑场景" : "新增场景"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{field("name", "名称")}</div>
            {field("description", "场景描述", true)}
            {field("environment", "环境描述", true)}
            {field("time", "时间")}
            {field("weather", "天气")}
            {field("color_style", "色调")}
            <div className="sm:col-span-2">{field("fixed_prompt", "固定场景 Prompt（一致性锁定）", true)}</div>
            <div className="sm:col-span-2"><Button type="submit" disabled={loading}>{loading ? "保存中..." : "保存"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
