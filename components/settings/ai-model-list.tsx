"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  AIModelForm,
  type AIModelFormData,
} from "@/components/settings/ai-model-form";

interface AIModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  modality: string;
  api_base: string | null;
  api_key: string | null;
  temperature: number;
  max_tokens: number | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const MODALITY_LABELS: Record<string, string> = {
  text: "文本模型",
  image: "图片模型",
  video: "视频模型",
};

export function AIModelList() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("text");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/user/ai-models");
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "加载失败");
        return [];
      }
      return (data.data || []) as AIModel[];
    } catch {
      toast.error("网络错误");
      return [];
    }
  }, []);

  // 初始加载
  useEffect(() => {
    let active = true;
    fetchModels().then((data) => {
      if (active) {
        setModels(data);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [fetchModels]);

  // 手动刷新
  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await fetchModels();
    setModels(data);
    setLoading(false);
  }, [fetchModels]);

  const handleCreate = () => {
    setEditingModel(null);
    setDialogOpen(true);
  };

  const handleEdit = (model: AIModel) => {
    setEditingModel(model);
    setDialogOpen(true);
  };

  const handleDelete = async (model: AIModel) => {
    if (!confirm(`确定删除「${model.name}」吗？`)) return;
    try {
      const res = await fetch(`/api/user/ai-models/${model.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "删除失败");
        return;
      }
      toast.success("模型已删除");
      refresh();
    } catch {
      toast.error("网络错误");
    }
  };

  const handleSetDefault = async (model: AIModel) => {
    try {
      const res = await fetch(
        `/api/user/ai-models/${model.id}/default`,
        { method: "PUT" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "设置失败");
        return;
      }
      toast.success(`已将「${model.name}」设为${MODALITY_LABELS[model.modality] || model.modality}默认`);
      refresh();
    } catch {
      toast.error("网络错误");
    }
  };

  const handleTest = async (model: AIModel) => {
    toast.info("测试中...");
    try {
      const res = await fetch("/api/user/ai-models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: model.id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`连通成功（${data.latency}ms）`);
      } else {
        toast.error(`连通失败: ${data.error}`);
      }
    } catch {
      toast.error("网络错误");
    }
  };

  const handleSubmit = async (formData: AIModelFormData) => {
    try {
      if (formData.id) {
        // 更新 — 只在 api_key 非空时才发送，空值表示用户未重新输入，保留原 key
        const patchBody: Record<string, unknown> = {
          name: formData.name,
          provider: formData.provider,
          model: formData.model,
          modality: formData.modality,
          api_base: formData.api_base,
          temperature: formData.temperature,
          max_tokens: formData.max_tokens,
        };
        if (formData.api_key?.trim()) {
          patchBody.api_key = formData.api_key.trim();
        }
        const res = await fetch(`/api/user/ai-models/${formData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "更新失败");
        }
        // 如果需要设为默认，单独调用
        if (formData.is_default) {
          await fetch(`/api/user/ai-models/${formData.id}/default`, {
            method: "PUT",
          });
        }
        toast.success("模型已更新");
      } else {
        // 新增
        const res = await fetch("/api/user/ai-models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            provider: formData.provider,
            model: formData.model,
            modality: formData.modality,
            api_base: formData.api_base,
            api_key: formData.api_key,
            temperature: formData.temperature,
            max_tokens: formData.max_tokens,
            is_default: formData.is_default,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "添加失败");
        }
        toast.success("模型已添加");
      }
      setDialogOpen(false);
      setEditingModel(null);
      refresh();
    } catch (err) {
      throw err;
    }
  };

  const filterByModality = (modality: string) =>
    models.filter((m) => m.modality === modality);

  const renderModelCard = (model: AIModel) => (
    <Card key={model.id} className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">{model.name}</span>
              {model.is_default && (
                <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                  默认
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>
                {model.provider} / {model.model}
              </div>
              {model.api_base && (
                <div className="font-mono truncate">
                  API: {model.api_base}
                </div>
              )}
              <div>
                Temperature: {model.temperature} / Max Tokens: {model.max_tokens ?? "默认最大"}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            {!model.is_default && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSetDefault(model)}
              >
                设为默认
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTest(model)}
            >
              测试
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEdit(model)}
            >
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-600"
              onClick={() => handleDelete(model)}
            >
              删除
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          共 {models.length} 个模型
        </p>
        <Button onClick={handleCreate} size="sm">
          添加模型
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="text">文本模型</TabsTrigger>
          <TabsTrigger value="image">图片模型</TabsTrigger>
          <TabsTrigger value="video">视频模型</TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              加载中...
            </p>
          ) : filterByModality("text").length > 0 ? (
            filterByModality("text").map(renderModelCard)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无文本模型，请点击「添加模型」创建
            </p>
          )}
        </TabsContent>

        <TabsContent value="image" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              加载中...
            </p>
          ) : filterByModality("image").length > 0 ? (
            filterByModality("image").map(renderModelCard)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无图片模型（Phase 4 启用图片生成后使用）
            </p>
          )}
        </TabsContent>

        <TabsContent value="video" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              加载中...
            </p>
          ) : filterByModality("video").length > 0 ? (
            filterByModality("video").map(renderModelCard)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无视频模型（Phase 4 启用视频生成后使用）
            </p>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingModel ? "编辑模型" : "添加模型"}
            </DialogTitle>
          </DialogHeader>
          <AIModelForm
            initialData={
              editingModel
                ? {
                    id: editingModel.id,
                    name: editingModel.name,
                    provider: editingModel.provider,
                    model: editingModel.model,
                    modality: editingModel.modality as AIModelFormData["modality"],
                    api_base: editingModel.api_base || "",
                    api_key: "",
                    temperature: editingModel.temperature,
                    max_tokens: editingModel.max_tokens,
                    is_default: editingModel.is_default,
                  }
                : undefined
            }
            modalityLocked={!!editingModel}
            onSubmit={handleSubmit}
            onCancel={() => {
              setDialogOpen(false);
              setEditingModel(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
