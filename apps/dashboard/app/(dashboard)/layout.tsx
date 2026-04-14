import Link from "next/link";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-56 shrink-0 border-r border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-6 text-sm font-semibold tracking-tight">Flux</div>
        <nav className="flex flex-col gap-1">
          <Link
            href="/projects"
            className="rounded-md px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            Projects
          </Link>
        </nav>
      </aside>
      <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
