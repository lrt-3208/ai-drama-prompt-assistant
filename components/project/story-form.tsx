"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useTaskPolling, type ActiveTask } from "@/hooks/use-task-polling";

interface StoryData {
  id?: string;
  raw_input: string;
  input_mode: string;
  theme: string | null;
  genre: string | null;
  core_conflict: string | null;
  target_emotion: string | null;
}

export function StoryForm({ projectId, initialStory, activeTask }: { projectId: string; initialStory: StoryData | null; activeTask?: ActiveTask | null }) {
  const router = useRouter();
  const [rawInput, setRawInput] = useState(initialStory?.raw_input ?? "");
  const [theme, setTheme] = useState(initialStory?.theme ?? "");
  const [genre, setGenre] = useState(initialStory?.genre ?? "");
  const [coreConflict, setCoreConflict] = useState(initialStory?.core_conflict ?? "");
  const [targetEmotion, setTargetEmotion] = useState(initialStory?.target_emotion ?? "");
  const [saving, setSaving] = useState(false);

  const { isGenerating, createTask } = useTaskPolling({
    projectId,
    initialTask: activeTask,
    onDone: (status) => {
      if (status === "success") toast.success("故事分析完成");
      else toast.error("故事分析失败");
      router.refresh();
    },
  });

  // 检测 raw_input 是否被修改
  const rawInputChanged = rawInput !== (initialStory?.raw_input ?? "");

  // 保存故事
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawInput.trim()) {
      toast.error("故事内容不能为空");
      return;
    }
    setSaving(true);

    const res = await fetch(`/api/projects/${projectId}/story`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw_input: rawInput,
        input_mode: "story",
        theme,
        genre,
        core_conflict: coreConflict,
        target_emotion: targetEmotion,
      }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      toast.error(data.error || "保存失败");
      return;
    }

    // 如果 raw_input 被修改，提示是否重新生成全部资产
    if (rawInputChanged) {
      const confirmed = window.confirm(
        "故事内容已修改，是否重新分析并更新角色、场景、风格？"
      );
      if (confirmed) {
        await triggerInitialize();
      } else {
        toast.success("故事已保存");
        router.refresh();
      }
    } else {
      toast.success("故事已保存");
      router.refresh();
    }
  };

  // 重新分析故事
  const handleAnalyze = async () => {
    toast.info("AI 分析中，请稍候...");
    try {
      await createTask("regenerate_story");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建任务失败");
    }
  };

  // 触发全量资产重新初始化
  const triggerInitialize = async () => {
    toast.info("正在重新生成全部资产...");
    const res = await fetch(`/api/projects/${projectId}/initialize`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "初始化失败");
      return;
    }
    router.refresh();
  };

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      {/* 原始创意 */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="rawInput">原始创意</Label>
        <Textarea
          id="rawInput"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder="输入你的故事创意，这是 AI 生成角色、场景、风格的基础..."
          rows={6}
        />
        <p className="text-xs text-muted-foreground">
          修改故事后保存，系统会提示是否重新生成全部资产。
        </p>
      </div>

      {/* AI 分析 */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <span className="w-1 h-4 bg-primary rounded" />
          <span className="text-sm font-medium text-foreground">AI 分析</span>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isGenerating || saving}
            className="ml-auto px-2.5 py-1 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition disabled:opacity-40"
          >
            {isGenerating ? "分析中..." : "✨ 重新分析故事"}
          </button>
        </div>
        <div className="p-5 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="theme" className="text-xs">主题</Label>
            <Input
              id="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="如：重生复仇豪门"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="genre" className="text-xs">类型</Label>
            <Input
              id="genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="如：都市/悬疑/古风"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coreConflict" className="text-xs">核心冲突</Label>
            <Input
              id="coreConflict"
              value={coreConflict}
              onChange={(e) => setCoreConflict(e.target.value)}
              placeholder="如：被背叛后重返家族夺回一切"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="targetEmotion" className="text-xs">情绪基调</Label>
            <Input
              id="targetEmotion"
              value={targetEmotion}
              onChange={(e) => setTargetEmotion(e.target.value)}
              placeholder="如：爽感+紧张+释放"
              className="text-xs"
            />
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || isGenerating}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition disabled:opacity-40"
        >
          {saving ? "保存中..." : "保存修改"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}/script`)}
          className="px-3 py-1.5 rounded-lg bg-surface2 border border-border text-muted-foreground text-[11px] hover:border-primary/50 hover:text-primary transition"
        >
          生成剧本 →
        </button>
      </div>
    </form>
  );
}
