"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export interface AIModelFormData {
  id?: string;
  name: string;
  provider: string;
  model: string;
  modality: "text" | "image" | "video";
  api_base: string;
  api_key: string;
  temperature: number;
  max_tokens: number | null;
  is_default: boolean;
}

interface AIModelFormProps {
  initialData?: Partial<AIModelFormData>;
  modalityLocked?: boolean;
  onSubmit: (data: AIModelFormData) => Promise<void>;
  onCancel: () => void;
}

export function AIModelForm({
  initialData,
  modalityLocked = false,
  onSubmit,
  onCancel,
}: AIModelFormProps) {
  const [name, setName] = useState(initialData?.name || "");
  const [provider, setProvider] = useState(initialData?.provider || "qwen");
  const [model, setModel] = useState(initialData?.model || "");
  const [modality, setModality] = useState<AIModelFormData["modality"]>(
    initialData?.modality || "text"
  );
  const [apiBase, setApiBase] = useState(initialData?.api_base || "");
  const [apiKey, setApiKey] = useState(initialData?.api_key || "");
  const [temperature, setTemperature] = useState(
    String(initialData?.temperature ?? 0.3)
  );
  const [maxTokens, setMaxTokens] = useState(
    initialData?.max_tokens ? String(initialData.max_tokens) : ""
  );
  const [isDefault, setIsDefault] = useState(initialData?.is_default || false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    // 编辑模式且未输入新 key → 用 model_id 从数据库取真实 key
    if (!apiKey.trim() && !initialData?.id) {
      toast.error("请先填写 API Key");
      return;
    }
    if (!apiBase.trim() && !initialData?.id) {
      toast.error("请先填写 API 地址");
      return;
    }
    setTesting(true);
    try {
      const testBody: Record<string, string> = {};
      if (apiKey.trim()) {
        // 用户输入了新 key → 直接用表单数据
        testBody.provider = provider || "qwen";
        testBody.model = model || "qwen3.7-max";
        testBody.api_base = apiBase;
        testBody.api_key = apiKey;
      } else if (initialData?.id) {
        // 编辑模式未输入新 key → 用 model_id 从数据库读取
        testBody.model_id = initialData.id;
      }
      const res = await fetch("/api/user/ai-models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testBody),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`连通成功（${data.latency}ms）`);
      } else {
        toast.error(`连通失败: ${data.error || data.error?.message}`);
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !model.trim()) {
      toast.error("模型名称和模型标识不能为空");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        id: initialData?.id,
        name: name.trim(),
        provider: provider.trim() || "qwen",
        model: model.trim(),
        modality,
        api_base: apiBase.trim(),
        api_key: apiKey.trim(),
        temperature: parseFloat(temperature),
        max_tokens: maxTokens.trim() ? parseInt(maxTokens, 10) : null,
        is_default: isDefault,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">模型名称</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：默认文本模型"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="provider">服务商</Label>
          <Input
            id="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="如：qwen / openai / deepseek"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="model">模型标识</Label>
          <Input
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="如：qwen3.7-max"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>模型类型 (modality)</Label>
        <div className="flex items-center gap-2">
          {(["text", "image", "video"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              variant={modality === m ? "default" : "outline"}
              size="sm"
              disabled={modalityLocked}
              onClick={() => setModality(m)}
            >
              {m === "text" ? "文本" : m === "image" ? "图片" : "视频"}
            </Button>
          ))}
          {modalityLocked && (
            <span className="text-xs text-muted-foreground">类型不可更改</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="apiBase">API 地址</Label>
        <Input
          id="apiBase"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder="如：https://api.example.com/v1"
          className="font-mono text-xs"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="apiKey">API Key</Label>
        <Input
          id="apiKey"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={initialData?.id ? "已配置（重新输入可修改，留空保持不变）" : "输入 API Key"}
          type="password"
          className="font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="temperature">Temperature</Label>
          <Input
            id="temperature"
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="maxTokens">Max Tokens</Label>
          <Input
            id="maxTokens"
            type="number"
            step="1"
            min="1"
            placeholder="不填则使用模型默认最大值"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant={isDefault ? "default" : "outline"}
          size="sm"
          onClick={() => setIsDefault(!isDefault)}
        >
          {isDefault ? "设为默认" : "设为默认"}
        </Button>
        {isDefault && (
          <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
            将设为该类型的默认模型
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "保存中..." : initialData?.id ? "更新模型" : "添加模型"}
        </Button>
        <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? "测试中..." : "测试连通性"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
