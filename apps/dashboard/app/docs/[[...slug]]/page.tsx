import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DocsLayout } from "@/src/components/docs/docs-layout";
import { DocsMarkdown } from "@/src/components/docs/docs-markdown";
import { loadDocPage } from "@/src/lib/docs-content";
import { getDocsFlatNav } from "@/src/lib/docs-nav";
import { docsBody, docsMuted, docsProseLink } from "@/src/components/docs/docs-styles";

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateStaticParams(): Promise<{ slug?: string[] }[]> {
  const flat = getDocsFlatNav();
  return [{ slug: undefined }, ...flat.map((item) => ({ slug: item.slug }))];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: segments } = await params;
  const slug = segments ?? [];
  const doc = await loadDocPage(slug);
  if (!doc) return { title: "Not found — Flux" };
  const title = doc.frontmatter.title ?? "Documentation";
  return {
    title: `${title} — Flux`,
    description: doc.frontmatter.description,
  };
}

export default async function DocsPage({ params }: Props) {
  const { slug: segments } = await params;
  const slug = segments ?? [];
  const doc = await loadDocPage(slug);
  if (!doc) notFound();

  return (
    <DocsLayout slug={slug}>
      <DocsMarkdown markdown={doc.body} />
      <aside
        className={`mt-14 max-w-3xl rounded-lg border border-zinc-200 bg-zinc-50/90 p-5 ${docsMuted} dark:border-zinc-800 dark:bg-zinc-950/40`}
      >
        <p className={docsBody}>
          Authoring rules live in{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] dark:bg-zinc-900/80">
            docs/_contract/
          </code>
          . Source for these pages:{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] dark:bg-zinc-900/80">
            docs/pages/
          </code>
          .
        </p>
        <p className={`mt-3 ${docsBody}`}>
          Questions?{" "}
          <Link href="/" className={docsProseLink}>
            Home assistant
          </Link>
        </p>
      </aside>
    </DocsLayout>
  );
}
