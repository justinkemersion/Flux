import { auth } from "@/src/lib/auth";
import { redirect } from "next/navigation";
import { DashboardChrome } from "@/src/components/dashboard/dashboard-chrome";

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

  return <DashboardChrome>{children}</DashboardChrome>;
}
