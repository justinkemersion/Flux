"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

const focusable =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-zinc-500/35 dark:focus-visible:ring-offset-zinc-950";

const focusableLanding =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

/** Calm bar typography — matches docs direction (readable sans, not terminal-mini). */
const barText =
  "text-[13px] leading-snug text-zinc-600 dark:text-zinc-400";

const barTextLanding = "text-[13px] leading-snug text-zinc-400";

const clockClass =
  "text-[12px] tabular-nums tracking-wide text-zinc-500 dark:text-zinc-500";

const clockClassLanding =
  "text-[12px] tabular-nums tracking-wide text-zinc-500";

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

function headerMaxWidth(pathname: string): string {
  if (pathname === "/") return "max-w-5xl";
  if (pathname.startsWith("/docs")) return "max-w-5xl";
  if (pathname.startsWith("/settings") || pathname.startsWith("/projects")) {
    return "max-w-6xl";
  }
  return "max-w-3xl";
}

export function WorkspaceHeader() {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const contentMaxClassName = headerMaxWidth(pathname);

  const headerSurface = isLanding
    ? "border-b border-zinc-800/90 bg-zinc-950"
    : "border-b border-zinc-200/90 bg-zinc-50/95 backdrop-blur-sm dark:border-zinc-800/90 dark:bg-zinc-950/95";

  const brandClass = isLanding
    ? `inline-flex items-center text-[15px] font-semibold tracking-tight text-zinc-100 transition-colors hover:text-white ${focusableLanding} rounded-md`
    : `inline-flex items-center text-[15px] font-semibold tracking-tight text-zinc-900 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-200 ${focusable} rounded-md`;

  return (
    <header className={`relative z-40 w-full ${headerSurface}`}>
      <div
        className={`mx-auto flex w-full items-center gap-6 px-4 py-3.5 sm:px-8 sm:px-10 ${contentMaxClassName}`}
        role="navigation"
        aria-label="Primary"
      >
        <div className="min-w-0 shrink-0 text-left">
          <Link href="/" className={brandClass}>
            Flux
          </Link>
        </div>
        <div className="flex min-w-0 flex-1 justify-center px-2">
          <UtcClock isLanding={isLanding} />
        </div>
        <div className="min-w-0 shrink-0">
          <StatusBarSession isLanding={isLanding} />
        </div>
      </div>
    </header>
  );
}

function UtcClock({ isLanding }: { isLanding: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <time
      className={`${isLanding ? clockClassLanding : clockClass} whitespace-nowrap`}
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
  const muted = isLanding ? barTextLanding : barText;
  const focus = isLanding ? focusableLanding : focusable;
  const hoverLink = isLanding
    ? "hover:text-zinc-100"
    : "hover:text-zinc-900 dark:hover:text-zinc-100";

  const docsLinkClass = `font-medium ${muted} shrink-0 rounded-md transition-colors ${hoverLink} ${focus}`;

  const sepClass = isLanding
    ? "select-none text-zinc-600"
    : "select-none text-zinc-300 dark:text-zinc-600";

  const authBtnClass = `${muted} shrink-0 rounded-md transition-colors ${hoverLink} ${focus}`;

  const DocsCluster = () => (
    <>
      <span className={sepClass} aria-hidden="true">
        |
      </span>
      <Link href="/docs" className={docsLinkClass}>
        Docs
      </Link>
    </>
  );

  if (status === "loading") {
    return (
      <div
        className={`flex flex-row flex-wrap items-center justify-end gap-x-2.5 gap-y-1 ${muted}`}
      >
        <span className="inline-block shrink-0">Loading session…</span>
        <DocsCluster />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div
        className={`flex flex-row flex-wrap items-center justify-end gap-x-2.5 gap-y-1`}
      >
        <button
          type="button"
          onClick={() =>
            void signIn("github", { callbackUrl: pathname || "/" })
          }
          className={authBtnClass}
        >
          Sign in with GitHub
        </button>
        <DocsCluster />
      </div>
    );
  }

  const id =
    session.user.githubLogin?.trim() ||
    session.user.name?.trim() ||
    session.user.email?.trim() ||
    "Unknown";

  return (
    <div
      className={`flex flex-row flex-wrap items-center justify-end gap-x-2.5 gap-y-1`}
    >
      <span
        className={`max-w-[min(100%,14rem)] truncate sm:max-w-[min(100%,24rem)] ${muted}`}
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
        className={authBtnClass}
      >
        Sign out
      </button>
      <DocsCluster />
    </div>
  );
}
