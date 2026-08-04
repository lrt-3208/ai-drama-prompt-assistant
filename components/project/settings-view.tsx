"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface SettingsViewProps {
  projectId: string;
  config: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    apiBase: string;
    apiKey: string;
  };
}

export function SettingsView({ projectId: _projectId, config }: SettingsViewProps) {
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [temperature, setTemperature] = useState(String(config.temperature));
  const [apiBase, setApiBase] = useState(config.apiBase);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [saving, setSaving] = useState(false);

  const hasApiKey = apiKey.length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          temperature: parseFloat(temperature),
          api_base: apiBase,
          api_key: apiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "保存失败");
        return;
      }
      toast.success("配置已更新，即时生效");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">设置</h2>
        <p className="text-sm text-muted-foreground">
          AI 模型完整配置。修改后保存即时生效，无需重启服务。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 模型配置</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
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
              <Label htmlFor="model">模型名称</Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="如：qwen3.7-max"
              />
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
                placeholder="输入 API Key"
                type="password"
                className="font-mono text-xs"
              />
              <div className="flex items-center gap-2">
                {hasApiKey ? (
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                    已配置
                  </Badge>
                ) : (
                  <Badge variant="destructive">未配置</Badge>
                )}
              </div>
            </div>

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

            <Button onClick={handleSave} disabled={saving} className="self-start mt-2">
              {saving ? "保存中..." : "保存配置"}
            </Button>
          </div>

          <div className="mt-6 p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">
              配置保存在数据库中，所有 AI 调用实时读取。首次使用前请先填写服务商、API 地址和 API Key。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
