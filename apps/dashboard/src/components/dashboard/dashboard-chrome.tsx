"use client";

import { useSession } from "next-auth/react";
import { DashboardFleetBar } from "./dashboard-fleet-bar";

export function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userSegment =
    session?.user?.githubLogin?.trim() ||
    session?.user?.id?.trim() ||
    "—";

  return (
    <div className="flex min-h-full w-full flex-1 flex-col bg-zinc-950 text-zinc-400">
      <DashboardFleetBar userSegment={userSegment} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-8 sm:py-10 lg:px-10">
        {children}
      </div>
    </div>
  );
}
