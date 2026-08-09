"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface StylePreset {
  id: string;
  name: string;
  category: string;
  fixed_prompt: string;
}

interface StylePresetSelectorProps {
  projectId: string;
  currentPresetId: string | null;
  presets: StylePreset[];
}

export function StylePresetSelector({ projectId, currentPresetId, presets }: StylePresetSelectorProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(currentPresetId || "none");
  const [lastPresetId, setLastPresetId] = useState(currentPresetId);
  const [loading, setLoading] = useState(false);

  // 当外部 currentPresetId 变化时同步本地状态（如 router.refresh 后）
  // React 推荐模式：在渲染期间检测 prop 变化并调整 state
  if (currentPresetId !== lastPresetId) {
    setLastPresetId(currentPresetId);
    setSelected(currentPresetId || "none");
  }

  const handleChange = async (value: string | null) => {
    const v = value || "none";
    setSelected(v);
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style_preset_id: v === "none" ? null : v,
        }),
      });
      if (!res.ok) throw new Error("更新失败");
      toast.success(v === "none" ? "已清除风格预设" : `已切换到 ${presets.find((p) => p.id === v)?.name || ""}`);
      router.refresh();
    } catch {
      toast.error("更新风格预设失败");
      setSelected(currentPresetId || "none");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Select value={selected} onValueChange={handleChange} disabled={loading}>
      <SelectTrigger className="w-[180px] h-8 text-xs">
        <SelectValue placeholder="选择风格预设">
          {selected === "none" ? "不使用预设" : presets.find((p) => p.id === selected)?.name || "选择风格预设"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">不使用预设</SelectItem>
        {presets.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
