"use client";

import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Cpu, ScrollText, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

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

  // 头像取昵称（或邮箱）首字
  const avatarChar = (nickname || userEmail || "?").trim().charAt(0).toUpperCase();

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-bold">
            AI 短剧 Prompt 助手
          </Link>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="打开用户菜单"
          >
            {avatarChar}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">
              {nickname} · {userEmail}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings/ai-models")}>
              <Cpu />
              AI 模型配置
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings/prompts")}>
              <ScrollText />
              提示词配置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleLogout}>
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
