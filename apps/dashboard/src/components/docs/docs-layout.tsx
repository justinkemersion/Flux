import Link from "next/link";
import {
  DOCS_NAV,
  docsHref,
  getAdjacentDocs,
} from "@/src/lib/docs-nav";
import { docsFocus, docsNavLabel, docsTocLink } from "./docs-styles";

export function DocsLayout({
  children,
  slug,
}: {
  children: React.ReactNode;
  slug: string[];
}) {
  const { prev, next } = getAdjacentDocs(slug);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-8 lg:flex-row lg:gap-12">
      <aside className="shrink-0 lg:w-56 xl:w-64">
        <nav aria-label="Documentation sections" className="lg:sticky lg:top-24">
          <Link
            href="/docs"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            Docs home
          </Link>
          <div className="mt-6 space-y-6">
            {DOCS_NAV.map((section) => (
              <div key={section.label}>
                <p className={docsNavLabel}>{section.label}</p>
                <ul className="mt-2 space-y-1">
                  {section.items.map((item) => {
                    const href = docsHref(item.slug);
                    const active = item.slug.join("/") === slug.join("/");
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          className={`${docsTocLink} ${docsFocus} block rounded-sm py-0.5 ${
                            active
                              ? "font-medium text-zinc-900 underline dark:text-zinc-100"
                              : ""
                          }`}
                        >
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <article className="max-w-3xl">{children}</article>
        <nav
          aria-label="Adjacent pages"
          className="mt-14 flex flex-wrap justify-between gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800"
        >
          {prev ? (
            <Link href={docsHref(prev.slug)} className={`${docsTocLink} ${docsFocus}`}>
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={docsHref(next.slug)} className={`${docsTocLink} ${docsFocus}`}>
              {next.title} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </div>
  );
}
