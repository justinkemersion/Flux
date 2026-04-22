"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";

type ProvidersProps = {
  children: React.ReactNode;
  session: Session | null;
};

export function Providers({ children, session }: ProvidersProps) {
  return (
    <SessionProvider
      refetchOnWindowFocus
      session={session}
    >
      {children}
    </SessionProvider>
  );
}
