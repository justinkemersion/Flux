import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { SettingsShell } from "@/src/components/settings/settings-shell";

export const runtime = "nodejs";

export default async function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/settings")}`);
  }

  return <SettingsShell>{children}</SettingsShell>;
}
