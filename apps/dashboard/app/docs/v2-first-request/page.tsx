import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/src/components/docs/code-block";

export const metadata: Metadata = {
  title: "Flux v2: First Request Guide",
  description:
    "Get your first successful request working in Flux v2 pooled projects.",
};

function safeParam(
  value: string | string[] | undefined,
  fallback: string,
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export default async function V2FirstRequestGuide({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const slug = safeParam(params.slug, "<slug>");
  const hash = safeParam(params.hash, "<hash>");
  const apiUrl = `https://api.${slug}.${hash}.vsl-base.com`;

  const firstRequest = `const token = await window.Clerk?.session?.getToken({ template: "flux" });

const fluxUrl = "${apiUrl}";
const res = await fetch(\`\${fluxUrl}/hops?select=*&limit=10\`, {
  headers: {
    Authorization: \`Bearer \${token}\`,
  },
});

if (!res.ok) {
  throw new Error(\`Flux request failed: \${res.status}\`);
}

const data = await res.json();
console.log(data);`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <div className="border-b border-zinc-800 pb-5">
        <Link
          href="/projects"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-300"
        >
          ← Back to projects
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-zinc-100">
          Flux v2: First Request Guide
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Goal: get your first successful request working quickly.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">1. Mental Model</h2>
        <ul className="mt-3 space-y-1 text-sm text-zinc-300">
          <li>v1 projects use static API keys.</li>
          <li>v2 projects use your Service URL plus user auth tokens.</li>
          <li>There are no static anon/service keys in v2 pooled projects.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">
          2. Your First Request
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Get a token from your auth provider, then call your Flux Service URL with{" "}
          <code>Authorization: Bearer ...</code>.
        </p>
        <div className="mt-3">
          <CodeBlock code={firstRequest} label="ts" language="ts" />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">
          3. Works vs Doesn&apos;t Work
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-emerald-900/60 bg-emerald-950/20 p-3">
            <p className="text-sm font-medium text-emerald-200">Works</p>
            <ul className="mt-2 space-y-1 text-sm text-emerald-100/90">
              <li>Fetch requests with `Authorization: Bearer token`</li>
            </ul>
          </div>
          <div className="rounded-md border border-red-900/60 bg-red-950/20 p-3">
            <p className="text-sm font-medium text-red-200">Doesn&apos;t</p>
            <ul className="mt-2 space-y-1 text-sm text-red-100/90">
              <li>Supabase client with anon key</li>
              <li>Direct PostgREST auth flows</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">4. Common Errors</h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          <li>
            <strong>401</strong>: token missing, expired, or invalid.
          </li>
          <li>
            <strong>403</strong>: token is valid but blocked by permissions/RLS.
          </li>
          <li>
            <strong>Empty response</strong>: query matched no rows (or filters are
            too strict).
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">5. What&apos;s Next</h2>
        <ul className="mt-3 space-y-1 pb-10 text-sm text-zinc-300">
          <li>Integrate token retrieval with Clerk or Auth.js.</li>
          <li>Keep building your app with normal fetch-based queries.</li>
        </ul>
      </section>
    </main>
  );
}
