import { PromptTemplateManager } from "@/components/settings/prompt-template-manager";

export default function PromptTemplatesPage() {
  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">提示词配置</h1>
        <p className="text-sm text-muted-foreground">
          自定义 15 个 LLM 节点的 System Prompt。模板中可用 &amp;变量
          引用项目配置（在编辑器输入 &amp; 触发补全）；支持连载模式差异化、版本历史与回滚。未配置时使用系统默认。
        </p>
      </div>
      <PromptTemplateManager />
    </div>
  );
}
