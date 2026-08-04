import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-muted/50">
      <div className="flex flex-col items-center gap-8 px-6 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            AI 短剧 Prompt 助手
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            从故事创意到专业 Prompt 的一站式生成工具。角色/场景/风格一致性锁定，多平台适配。
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            开始使用
          </Link>
          <Link
            href="/register"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-input bg-background px-8 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            注册账号
          </Link>
        </div>
      </div>
    </div>
  );
}
