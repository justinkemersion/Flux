"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const navItems = [
  { href: "/settings/keys", label: "API Keys", match: "/settings/keys" },
  { href: "/settings/mcp-tokens", label: "MCP Tokens", match: "/settings/mcp-tokens" },
] as const;

export function SettingsShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/settings";

  return (
    <>
      <nav
        className="mb-8 flex flex-wrap gap-2 border-b border-zinc-800/90 pb-4"
        aria-label="Settings sections"
      >
        {navItems.map((item) => {
          const active = pathname === item.match;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${focus} ${
                active
                  ? "bg-zinc-800/80 text-zinc-100"
                  : "text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </>
  );
}
