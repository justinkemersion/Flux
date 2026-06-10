import Link from "next/link";

const linkClass =
  "text-sm text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded-sm";

export function LandingFooter() {
  return (
    <footer className="mt-24 border-t border-zinc-800 pt-8 sm:mt-32">
      <nav
        aria-label="Footer"
        className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-xs text-zinc-600">Flux — a foundry for small durable apps.</p>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <li>
            <Link href="/docs/introduction/what-is-flux" className={linkClass}>
              Docs
            </Link>
          </li>
          <li>
            <Link href="/why-flux" className={linkClass}>
              Why Flux
            </Link>
          </li>
          <li>
            <a href="https://vsl-base.com/" target="_blank" rel="noopener noreferrer" className={linkClass}>
              vsl-base.com
            </a>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
