import { auth } from "@/src/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user) {
    redirect(
      `/api/auth/signin?callbackUrl=${encodeURIComponent("/projects")}`,
    );
  }

  return (
    <div className="flex min-h-full flex-1 bg-zinc-50 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      {children}
    </div>
  );
}
