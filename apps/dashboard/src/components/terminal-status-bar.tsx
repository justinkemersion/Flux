"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

const focusable =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500";

const barText =
  "font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500 sm:text-[11px] sm:tracking-[0.16em]";

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

export function TerminalStatusBar() {
  const pathname = usePathname();
  const contentMaxClassName =
    pathname === "/projects" ? "max-w-6xl" : "max-w-3xl";

  return (
    <header className="w-full border-b border-zinc-800 bg-zinc-950">
      <div
        className={`mx-auto flex w-full items-center gap-3 px-4 py-2.5 sm:px-8 sm:py-2.5 ${contentMaxClassName}`}
        role="navigation"
        aria-label="System status"
      >
        <div className="min-w-0 flex-1 text-left">
          <Link
            href="/"
            className={`${barText} block truncate transition-colors hover:text-zinc-400 ${focusable}`}
          >
            VESSEL // CORE_SYSTEM // FLUX
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
      className={`${barText} whitespace-nowrap tabular-nums`}
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
    return (
      <span className={`${barText} inline-block`}>
        [ SCANNING_SESSION ]
      </span>
    );
  }

  if (!session?.user) {
    return (
      <button
        type="button"
        onClick={() => void signIn("github")}
        className={`${barText} transition-colors hover:text-zinc-400 ${focusable}`}
      >
        [ SIGN_IN ]
      </button>
    );
  }

  const id =
    session.user.githubLogin?.trim() ||
    session.user.name?.trim() ||
    session.user.email?.trim() ||
    "UNKNOWN";

  return (
    <div
      className={`${barText} flex flex-col items-end gap-1 sm:inline-flex sm:flex-row sm:items-baseline sm:gap-0 sm:pl-2`}
    >
      <span
        className="max-w-full truncate text-left sm:max-w-[min(100%,28rem)] sm:text-right"
        title={id}
      >
        {`Show: GITHUB: ${id} // STATUS: ACTIVE // `}
      </span>
      <button
        type="button"
        onClick={() => {
          void signOut({
            callbackUrl: pathname.startsWith("/projects") ? "/projects" : "/",
          });
        }}
        className={`${barText} shrink-0 bg-transparent text-left sm:inline sm:text-right ${focusable} transition-colors hover:text-zinc-400`}
      >
        [ TERMINATE_SESSION ]
      </button>
    </div>
  );
}
