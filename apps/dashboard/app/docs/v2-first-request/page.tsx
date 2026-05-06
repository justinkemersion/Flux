import type { Metadata } from "next";
import Link from "next/link";
import { fluxApiUrlForV2Shared } from "@flux/core/standalone";
import { CodeBlock } from "@/src/components/docs/code-block";
import {
  docsBackLink,
  docsBody,
  docsInlineCode,
  docsMuted,
  docsPageSubtitle,
  docsPageTitle,
  docsProseLink,
  docsSectionTitle,
  docsSubsectionTitle,
} from "@/src/components/docs/docs-styles";

export const metadata: Metadata = {
  title: "Pooled Stack: First Request — Flux Docs",
  description:
    "Make your first successful request to a Flux pooled stack project using your app's auth tokens.",
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
  const apiUrl = fluxApiUrlForV2Shared(slug, hash, process.env.NODE_ENV === "production");

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

  const browserExample = `export async function getHops() {
  const token = await window.Clerk?.session?.getToken({ template: "flux" });

  const res = await fetch(
    \`\${process.env.NEXT_PUBLIC_FLUX_URL}/hops?select=*&limit=10\`,
    {
      headers: {
        Authorization: \`Bearer \${token}\`,
      },
    }
  );

  if (!res.ok) throw new Error("Failed to fetch hops");

  return res.json();
}`;

  const serverExample = `export async function getHopsServer(token: string) {
  const res = await fetch(
    \`\${process.env.FLUX_URL}/hops?select=*&limit=10\`,
    {
      headers: {
        Authorization: \`Bearer \${token}\`,
      },
      cache: "no-store",
    }
  );

  if (!res.ok) throw new Error("Flux request failed");

  return res.json();
}`;

  const curlExample = `curl "${apiUrl}/hops?select=*&limit=5" \\
  -H "Authorization: Bearer <TOKEN>"`;

  const insertExample = `await fetch(\`\${fluxUrl}/hops\`, {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${token}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Citra",
  }),
});`;

  const filterExample = `await fetch(\`\${fluxUrl}/hops?name=eq.Citra\`, {
  headers: {
    Authorization: \`Bearer \${token}\`,
  },
});`;

  const updateExample = `await fetch(\`\${fluxUrl}/hops?id=eq.1\`, {
  method: "PATCH",
  headers: {
    Authorization: \`Bearer \${token}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name: "Mosaic" }),
});`;

  const deleteExample = `await fetch(\`\${fluxUrl}/hops?id=eq.1\`, {
  method: "DELETE",
  headers: {
    Authorization: \`Bearer \${token}\`,
  },
});`;

  const helperExample = `export async function fluxFetch(path: string) {
  const token = await window.Clerk?.session?.getToken({ template: "flux" });

  return fetch(\`\${process.env.NEXT_PUBLIC_FLUX_URL}\${path}\`, {
    headers: {
      Authorization: \`Bearer \${token}\`,
    },
  });
}`;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
      <header className="border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <Link href="/docs" className={docsBackLink}>
          ← Documentation
        </Link>
        <h1 className={`mt-4 ${docsPageTitle}`}>Pooled stack: first request</h1>
        <p className={docsPageSubtitle}>
          Pooled stack projects use your app&apos;s auth tokens — no static API keys required.
        </p>
      </header>

      <section className="mt-10">
        <h2 className={docsSectionTitle}>1. How it works</h2>
        <ul className={`mt-4 list-disc space-y-2 pl-5 ${docsBody}`}>
          <li>Dedicated stack projects use static API key patterns.</li>
          <li>Pooled stack projects use your Service URL and user auth tokens.</li>
          <li>
            There are no static anonymous or service-role keys for pooled projects. Flux validates
            tokens at the gateway and routes requests to the correct database.
          </li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className={docsSectionTitle}>2. Your first request</h2>
        <p className={`mt-3 ${docsMuted}`}>
          Paste this in a browser console or a short script to verify your connection:
        </p>
        <div className="mt-4">
          <CodeBlock code={firstRequest} label="ts" language="ts" />
        </div>
      </section>

      <section className="mt-12">
        <h2 className={docsSectionTitle}>3. Use this in your app</h2>
        <div className="mt-4 space-y-8">
          <div>
            <h3 className={docsSubsectionTitle}>Browser (React / Next.js client component)</h3>
            <div className="mt-3">
              <CodeBlock code={browserExample} label="ts" language="ts" />
            </div>
          </div>
          <div>
            <h3 className={docsSubsectionTitle}>Server (Next.js route handler or server action)</h3>
            <div className="mt-3">
              <CodeBlock code={serverExample} label="ts" language="ts" />
            </div>
          </div>
          <div>
            <h3 className={docsSubsectionTitle}>cURL (debugging)</h3>
            <div className="mt-3">
              <CodeBlock code={curlExample} label="bash" language="bash" />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className={docsSectionTitle}>4. Common patterns</h2>
        <div className="mt-4 space-y-8">
          <div>
            <h3 className={docsSubsectionTitle}>Insert</h3>
            <div className="mt-3">
              <CodeBlock code={insertExample} label="ts" language="ts" />
            </div>
          </div>
          <div>
            <h3 className={docsSubsectionTitle}>Filter</h3>
            <div className="mt-3">
              <CodeBlock code={filterExample} label="ts" language="ts" />
            </div>
          </div>
          <div>
            <h3 className={docsSubsectionTitle}>Update</h3>
            <div className="mt-3">
              <CodeBlock code={updateExample} label="ts" language="ts" />
            </div>
          </div>
          <div>
            <h3 className={docsSubsectionTitle}>Delete</h3>
            <div className="mt-3">
              <CodeBlock code={deleteExample} label="ts" language="ts" />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className={docsSectionTitle}>5. What works and what doesn&apos;t</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-200/90 bg-emerald-50/70 p-4 dark:border-emerald-900/55 dark:bg-emerald-950/25">
            <p className={`text-sm font-semibold text-emerald-900 dark:text-emerald-200`}>Works</p>
            <ul className={`mt-3 space-y-2 text-sm leading-relaxed text-emerald-900/90 dark:text-emerald-100/90`}>
              <li>
                <code className="rounded bg-emerald-200/60 px-1 py-0.5 font-mono text-[12px] text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50">
                  Authorization: Bearer &lt;token&gt;
                </code>
              </li>
              <li>Clerk, Auth.js, or any provider that issues JWTs</li>
            </ul>
          </div>
          <div className="rounded-lg border border-red-200/90 bg-red-50/70 p-4 dark:border-red-900/55 dark:bg-red-950/25">
            <p className={`text-sm font-semibold text-red-900 dark:text-red-200`}>Doesn&apos;t work</p>
            <ul className={`mt-3 space-y-2 text-sm leading-relaxed text-red-900/90 dark:text-red-100/90`}>
              <li>Supabase client with an anon key</li>
              <li>Direct PostgREST credentials</li>
              <li>Unauthenticated requests (unless explicitly allowed by policy)</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className={docsSectionTitle}>6. Common errors</h2>
        <div className={`mt-4 space-y-6 ${docsBody}`}>
          <div>
            <h3 className={docsSubsectionTitle}>401 Unauthorized</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Token is missing or was not included in the request</li>
              <li>Token has expired — fetch a fresh one from your auth provider</li>
              <li>Wrong JWT template — ensure your provider is configured for Flux</li>
            </ul>
          </div>
          <div>
            <h3 className={docsSubsectionTitle}>403 Forbidden</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Row-level security policies are blocking the request</li>
              <li>The database role lacks permissions on that table</li>
            </ul>
          </div>
          <div>
            <h3 className={docsSubsectionTitle}>Empty response</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>The table exists but has no rows yet</li>
              <li>Your filters did not match any rows</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-12 pb-12">
        <h2 className={docsSectionTitle}>7. Next steps</h2>
        <ul className={`mt-4 list-disc space-y-2 pl-5 ${docsBody}`}>
          <li>
            Store your Service URL in an environment variable (for example{" "}
            <code className={docsInlineCode}>NEXT_PUBLIC_FLUX_URL</code>)
          </li>
          <li>Use your auth provider for fresh tokens — do not hardcode them</li>
          <li>Centralize requests in a small helper:</li>
        </ul>
        <div className="mt-4">
          <CodeBlock code={helperExample} label="ts" language="ts" />
        </div>
        <p className={`mt-8 ${docsMuted}`}>
          Back to{" "}
          <Link href="/docs" className={docsProseLink}>
            Documentation
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
