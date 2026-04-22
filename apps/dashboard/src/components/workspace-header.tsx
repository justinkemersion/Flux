"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

const focusable =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-zinc-500/35 dark:focus-visible:ring-offset-zinc-950";

const focusableLanding =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const barMuted = "text-xs text-zinc-500 dark:text-zinc-500";

const barMutedLanding = "text-xs text-zinc-500";

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
  if (pathname === "/projects") {
    return null;
  }
  const isLanding = pathname === "/";
  const contentMaxClassName = isLanding
    ? "max-w-5xl"
    : pathname === "/projects"
      ? "max-w-6xl"
      : "max-w-3xl";

  const headerSurface = isLanding
    ? "border-b border-zinc-800 bg-zinc-950"
    : "border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/90";

  const brandClass = isLanding
    ? `inline-flex items-center text-sm font-semibold tracking-tight text-zinc-100 transition-colors hover:text-white ${focusableLanding} rounded-md`
    : `inline-flex items-center text-sm font-semibold tracking-tight text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300 ${focusable} rounded-md`;

  return (
    <header className={`w-full ${headerSurface}`}>
      <div
        className={`mx-auto flex w-full items-center gap-4 px-4 py-3 sm:px-8 sm:px-10 ${contentMaxClassName}`}
        role="navigation"
        aria-label="Primary"
      >
        <div className="min-w-0 flex-1 text-left">
          <Link href="/" className={brandClass}>
            Flux
          </Link>
        </div>
        <div className="shrink-0 text-center">
          <UtcClock isLanding={isLanding} />
        </div>
        <div className="min-w-0 flex-1 text-right">
          <StatusBarSession isLanding={isLanding} />
        </div>
      </div>
    </header>
  );
}

function UtcClock({ isLanding }: { isLanding: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const muted = isLanding ? barMutedLanding : barMuted;

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <time
      className={`${muted} whitespace-nowrap tabular-nums`}
      dateTime={now.toISOString()}
      suppressHydrationWarning
    >
      {formatUtc(now)}
    </time>
  );
}

function StatusBarSession({ isLanding }: { isLanding: boolean }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const muted = isLanding ? barMutedLanding : barMuted;
  const focus = isLanding ? focusableLanding : focusable;
  const hoverMuted = isLanding
    ? "hover:text-zinc-200"
    : "hover:text-zinc-800 dark:hover:text-zinc-300";

  if (status === "loading") {
    return <span className={`${muted} inline-block`}>Loading session…</span>;
  }

  if (!session?.user) {
    return (
      <button
        type="button"
        onClick={() => void signIn("github")}
        className={`${muted} rounded-md transition-colors ${hoverMuted} ${focus}`}
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
      className={`${muted} flex flex-col items-end gap-1 sm:inline-flex sm:flex-row sm:items-baseline sm:gap-2`}
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
        className={`shrink-0 rounded-md bg-transparent text-left sm:inline sm:text-right ${focus} transition-colors ${hoverMuted}`}
      >
        Sign out
      </button>
    </div>
  );
}
