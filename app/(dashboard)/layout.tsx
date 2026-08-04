import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("id", user.id)
    .single();

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardNav userEmail={user.email ?? ""} nickname={profile?.nickname ?? "用户"} />
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
