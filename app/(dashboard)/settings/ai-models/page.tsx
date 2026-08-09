import { AIModelList } from "@/components/settings/ai-model-list";

export default function AIModelsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">AI 模型管理</h1>
        <p className="text-sm text-muted-foreground">
          为文本、图片、视频生成分别配置 AI 模型。每个类型可设置一个默认模型，所有 AI 调用实时读取配置。
        </p>
      </div>
      <AIModelList />
    </div>
  );
}
