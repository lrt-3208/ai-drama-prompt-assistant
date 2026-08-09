"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface DashboardNavProps {
  userEmail: string;
  nickname: string;
}

export function DashboardNav({ userEmail, nickname }: DashboardNavProps) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("已退出登录");
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-bold">
            AI 短剧 Prompt 助手
          </Link>
          <Link
            href="/settings/ai-models"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            AI 模型
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{nickname} · {userEmail}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            退出
          </Button>
        </div>
      </div>
    </header>
  );
}
