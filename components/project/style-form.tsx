"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useTaskPolling, type ActiveTask } from "@/hooks/use-task-polling";

interface StyleData {
  id?: string;
  name: string;
  camera_style: string | null;
  color: string | null;
  lighting: string | null;
  cinematography: string | null;
  fixed_prompt: string;
}

const empty: Record<string, string> = { name: "", camera_style: "", color: "", lighting: "", cinematography: "", fixed_prompt: "" };

export function StyleForm({ projectId, initial, activeTask }: { projectId: string; initial: StyleData | null; activeTask?: ActiveTask | null }) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>(initial ? {
    name: initial.name, camera_style: initial.camera_style || "", color: initial.color || "",
    lighting: initial.lighting || "", cinematography: initial.cinematography || "", fixed_prompt: initial.fixed_prompt,
  } : empty);
  const [loading, setLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  const { isGenerating, createTask } = useTaskPolling({
    projectId,
    initialTask: activeTask,
    onDone: (status) => {
      if (status === "success") toast.success("风格生成完成");
      else toast.error("风格生成失败");
      router.refresh();
    },
  });

  // Sync when initial changes (after AI generates new style)
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    if (initial) {
      setForm({
        name: initial.name, camera_style: initial.camera_style || "", color: initial.color || "",
        lighting: initial.lighting || "", cinematography: initial.cinematography || "", fixed_prompt: initial.fixed_prompt,
      });
    } else {
      setForm(empty);
    }
  }

  const handleGenerate = () => {
    const confirmed = window.confirm("将替换现有风格，是否继续？");
    if (!confirmed) return;

    createTask("regenerate_style", { customPrompt: aiPrompt || undefined });
    setAiPrompt("");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.fixed_prompt.trim()) { toast.error("名称和固定 Prompt 不能为空"); return; }
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/style`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error || "保存失败"); return; }
    toast.success("视觉风格已保存");
  };

  const field = (key: string, label: string, multiline = false) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={key}>{label}</Label>
      {multiline ? <Textarea id={key} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} rows={3} />
        : <Input id={key} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 生成视觉风格</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            placeholder="输入你的要求（可选）... 如：调整为更暗黑的赛博朋克风格"
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
            {isGenerating ? "AI 生成中..." : "AI 生成风格"}
          </Button>
        </CardContent>
      </Card>

      <form onSubmit={handleSave} className="flex flex-col gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">视觉风格</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {field("name", "风格名称")}
            {field("camera_style", "摄影风格")}
            {field("color", "色彩方案")}
            {field("lighting", "光影")}
            {field("cinematography", "镜头语言")}
            <div className="sm:col-span-2">{field("fixed_prompt", "固定风格 Prompt（一致性锁定）", true)}</div>
          </CardContent>
        </Card>
        <Button type="submit" disabled={loading} className="self-start">
          {loading ? "保存中..." : "保存修改"}
        </Button>
      </form>
    </div>
  );
}
