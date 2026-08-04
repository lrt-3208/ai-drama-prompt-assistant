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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">AI 分析</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAnalyze}
              disabled={isGenerating || saving}
            >
              {isGenerating ? "分析中..." : "重新分析故事"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="theme">主题</Label>
            <Input
              id="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="如：重生复仇豪门"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="genre">类型</Label>
            <Input
              id="genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="如：都市/悬疑/古风"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coreConflict">核心冲突</Label>
            <Input
              id="coreConflict"
              value={coreConflict}
              onChange={(e) => setCoreConflict(e.target.value)}
              placeholder="如：被背叛后重返家族夺回一切"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="targetEmotion">情绪基调</Label>
            <Input
              id="targetEmotion"
              value={targetEmotion}
              onChange={(e) => setTargetEmotion(e.target.value)}
              placeholder="如：爽感+紧张+释放"
            />
          </div>
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <Button type="submit" disabled={saving || isGenerating}>
          {saving ? "保存中..." : "保存修改"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/projects/${projectId}/script`)}>
          生成剧本
        </Button>
      </div>
    </form>
  );
}
