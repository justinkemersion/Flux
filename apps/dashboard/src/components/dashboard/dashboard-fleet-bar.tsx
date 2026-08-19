"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { readResponseJson } from "@/src/lib/fetch-json";

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

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

type FleetProjectRow = {
  status?: string;
};

function settingsTrailSegment(pathname: string): { href?: string; label: string }[] {
  if (pathname === "/settings") {
    return [{ label: "Settings" }];
  }
  if (pathname === "/settings/keys") {
    return [
      { href: "/settings", label: "Settings" },
      { label: "API Keys" },
    ];
  }
  if (pathname === "/settings/mcp-tokens") {
    return [
      { href: "/settings", label: "Settings" },
      { label: "MCP Tokens" },
    ];
  }
  return [{ label: "Settings" }];
}

function breadcrumbTrail(
  pathname: string,
  userSegment: string,
): { href?: string; label: string; title?: string }[] {
  const trail: { href?: string; label: string; title?: string }[] = [
    { href: "/", label: "Flux" },
    { href: "/projects", label: "Projects" },
    { label: userSegment, title: userSegment },
  ];

  if (pathname.startsWith("/settings")) {
    trail.push(...settingsTrailSegment(pathname));
    return trail;
  }

  if (pathname === "/agent-activity") {
    trail.push({ label: "Agent Activity" });
    return trail;
  }

  const projectSlugMatch = /^\/projects\/([^/]+)$/.exec(pathname);
  if (projectSlugMatch) {
    trail.push({ label: projectSlugMatch[1] ?? "Project" });
  }

  return trail;
}

function useFleetBarStatus(): { fleetLine: string; fleetDegraded: boolean } {
  const [fleetLine, setFleetLine] = useState("Operational");
  const [fleetDegraded, setFleetDegraded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const refresh = async () => {
      try {
        const res = await fetch("/api/projects", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await readResponseJson(res, {
          apiLabel: "projects API",
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setFleetLine("Fleet error");
          setFleetDegraded(true);
          return;
        }
        const projects = Array.isArray(payload)
          ? payload
          : payload &&
              typeof payload === "object" &&
              "projects" in payload &&
              Array.isArray((payload as { projects: unknown }).projects)
            ? (payload as { projects: FleetProjectRow[] }).projects
            : [];
        const bad = projects.some(
          (p) => p.status === "missing" || p.status === "corrupted",
        );
        if (bad) {
          setFleetLine("Needs attention");
          setFleetDegraded(true);
          return;
        }
        setFleetLine("All projects healthy");
        setFleetDegraded(false);
      } catch {
        if (controller.signal.aborted) return;
        setFleetLine("Fleet error");
        setFleetDegraded(true);
      }
    };

    // Timer callbacks make this effect a polling subscription rather than a
    // synchronous state cascade. A zero-delay first tick preserves the
    // previous immediate-refresh behavior.
    const initialId = setTimeout(() => void refresh(), 0);
    const intervalId = setInterval(() => void refresh(), 15000);
    return () => {
      controller.abort();
      clearTimeout(initialId);
      clearInterval(intervalId);
    };
  }, []);

  return { fleetLine, fleetDegraded };
}

export function DashboardFleetBar({ userSegment }: { userSegment: string }) {
  const pathname = usePathname() ?? "/projects";
  const [now, setNow] = useState(() => new Date());
  const { fleetLine, fleetDegraded } = useFleetBarStatus();
  const trail = breadcrumbTrail(pathname, userSegment);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-md">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:px-8 lg:px-10">
        <nav
          className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-zinc-400"
          aria-label="Breadcrumb"
        >
          {trail.map((segment, idx) => (
            <span key={`${segment.label}-${idx}`} className="flex min-w-0 items-center gap-2">
              {idx > 0 ? (
                <span className="text-zinc-600" aria-hidden>
                  /
                </span>
              ) : null}
              {segment.href ? (
                <Link
                  href={segment.href}
                  className={`shrink-0 transition-colors hover:text-zinc-100 ${idx === 0 ? `font-medium text-zinc-100 hover:text-white ${focus}` : `text-zinc-300 ${focus}`}`}
                >
                  {segment.label}
                </Link>
              ) : (
                <span
                  className={`min-w-0 truncate ${
                    idx === trail.length - 1
                      ? "text-zinc-200"
                      : segment.title
                        ? "text-zinc-500"
                        : "text-zinc-200"
                  }`}
                  title={segment.title}
                >
                  {segment.label}
                </span>
              )}
            </span>
          ))}
        </nav>

        <div className="flex justify-center">
          <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
            {fleetDegraded ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/90"
                aria-hidden
              />
            ) : (
              <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/35" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
            )}
            <span className="whitespace-nowrap">
              {fleetDegraded ? fleetLine : "Operational"}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:justify-self-end">
          <span className="whitespace-nowrap text-xs text-zinc-600" title={`UTC ${formatUtc(now)}`}>
            UTC
          </span>
          <Link
            href="/docs"
            className={`rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300 ${focus}`}
          >
            Docs
          </Link>
          <Link
            href="/agent-activity"
            className={`rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300 ${focus}`}
          >
            Agent Activity
          </Link>
          <Link
            href="/settings"
            className={`rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300 ${focus}`}
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={() => {
              void signOut({ callbackUrl: "/projects" });
            }}
            className={`rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300 ${focus}`}
          >
            Sign out
          </button>
          <Link
            href="/projects?create=1"
            className={`rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800 ${focus}`}
          >
            + New Project
          </Link>
        </div>
      </div>
    </header>
  );
}
