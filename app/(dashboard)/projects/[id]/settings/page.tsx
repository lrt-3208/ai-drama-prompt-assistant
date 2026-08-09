import { SettingsView } from "@/components/project/settings-view";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <SettingsView projectId={id} />;
}
