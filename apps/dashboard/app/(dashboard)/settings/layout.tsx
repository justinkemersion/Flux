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

  const userSegment =
    session.user.githubLogin?.trim() ||
    session.user.id?.trim() ||
    "—";

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-400">
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 lg:px-10">
        <SettingsShell userSegment={userSegment}>{children}</SettingsShell>
      </div>
    </div>
  );
}
