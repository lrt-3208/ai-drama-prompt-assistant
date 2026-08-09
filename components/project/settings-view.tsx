"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SettingsViewProps {
  projectId: string;
}

export function SettingsView({ projectId }: SettingsViewProps) {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">项目设置</h2>
        <p className="text-sm text-muted-foreground">
          项目基础信息和 AI 模型配置管理。
        </p>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">AI 模型配置</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            AI 模型配置已迁移到全局管理页面。每个用户可为文本、图片、视频生成分别配置独立的默认模型。
          </p>
          <Link href="/settings/ai-models">
            <Button variant="outline" size="sm">
              前往 AI 模型管理
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">项目信息</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            项目 ID: <span className="font-mono text-xs">{projectId}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
