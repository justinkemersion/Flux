"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

const focusable =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-zinc-500/35 dark:focus-visible:ring-offset-zinc-950";

const barMuted = "text-xs text-zinc-500 dark:text-zinc-500";

function formatUtc(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  const y = d.getUTCFullYear();
  const mo = p(d.getUTCMonth() + 1);
  const day = p(d.getUTCDate());
  const h = p(d.getUTCHours());
  const m = p(d.getUTCMinutes());
  const s = p(d.getUTCSeconds());
  return `${y}-${mo}-${day} ${h}:${m}:${s} UTC`;
}

export function WorkspaceHeader() {
  const pathname = usePathname();
  const contentMaxClassName =
    pathname === "/projects" ? "max-w-6xl" : "max-w-3xl";

  return (
    <header className="w-full border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/90">
      <div
        className={`mx-auto flex w-full items-center gap-4 px-4 py-3 sm:px-8 ${contentMaxClassName}`}
        role="navigation"
        aria-label="Primary"
      >
        <div className="min-w-0 flex-1 text-left">
          <Link
            href="/"
            className={`inline-flex items-center text-sm font-semibold tracking-tight text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300 ${focusable} rounded-md`}
          >
            Flux
          </Link>
        </div>
        <div className="shrink-0 text-center">
          <UtcClock />
        </div>
        <div className="min-w-0 flex-1 text-right">
          <StatusBarSession />
        </div>
      </div>
    </header>
  );
}

function UtcClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <time
      className={`${barMuted} whitespace-nowrap tabular-nums`}
      dateTime={now.toISOString()}
      suppressHydrationWarning
    >
      {formatUtc(now)}
    </time>
  );
}

function StatusBarSession() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <span className={`${barMuted} inline-block`}>Loading session…</span>;
  }

  if (!session?.user) {
    return (
      <button
        type="button"
        onClick={() => void signIn("github")}
        className={`${barMuted} rounded-md transition-colors hover:text-zinc-800 dark:hover:text-zinc-300 ${focusable}`}
      >
        Sign in with GitHub
      </button>
    );
  }

  const id =
    session.user.githubLogin?.trim() ||
    session.user.name?.trim() ||
    session.user.email?.trim() ||
    "Unknown";

  return (
    <div
      className={`${barMuted} flex flex-col items-end gap-1 sm:inline-flex sm:flex-row sm:items-baseline sm:gap-2`}
    >
      <span
        className="max-w-full truncate text-left sm:max-w-[min(100%,28rem)] sm:text-right"
        title={id}
      >
        {id}
      </span>
      <button
        type="button"
        onClick={() => {
          void signOut({
            callbackUrl: pathname.startsWith("/projects") ? "/projects" : "/",
          });
        }}
        className={`shrink-0 rounded-md bg-transparent text-left sm:inline sm:text-right ${focusable} transition-colors hover:text-zinc-800 dark:hover:text-zinc-300`}
      >
        Sign out
      </button>
    </div>
  );
}
