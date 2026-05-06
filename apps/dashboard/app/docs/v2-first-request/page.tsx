import type { Metadata } from "next";
import Link from "next/link";
import { fluxApiUrlForV2Shared } from "@flux/core/standalone";
import { CodeBlock } from "@/src/components/docs/code-block";

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
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-8">
      <div className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <Link
          href="/docs"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          ← Documentation
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Pooled Stack: First Request
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Pooled stack projects use your app&apos;s auth tokens — no static API keys required.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          1. How it works
        </h2>
        <ul className="mt-3 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>Dedicated stack projects use static API key patterns.</li>
          <li>Pooled stack projects use your Service URL and user auth tokens.</li>
          <li>
            There are no static anonymous or service-role keys for pooled projects. Flux
            validates tokens at the gateway and routes requests to the correct database.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          2. Your first request
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Paste this in a browser console or a quick script to verify your connection:
        </p>
        <div className="mt-3">
          <CodeBlock code={firstRequest} label="ts" language="ts" />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          3. Use this in your app
        </h2>
        <div className="mt-3 space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              Browser (React / Next.js client component)
            </h3>
            <CodeBlock code={browserExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              Server (Next.js route handler or server action)
            </h3>
            <CodeBlock code={serverExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              cURL (debugging)
            </h3>
            <CodeBlock code={curlExample} label="bash" language="bash" />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          4. Common patterns
        </h2>
        <div className="mt-3 space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">Insert</h3>
            <CodeBlock code={insertExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">Filter</h3>
            <CodeBlock code={filterExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">Update</h3>
            <CodeBlock code={updateExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">Delete</h3>
            <CodeBlock code={deleteExample} label="ts" language="ts" />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          5. What works and what doesn&apos;t
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Works</p>
            <ul className="mt-2 space-y-1 text-sm text-emerald-700 dark:text-emerald-100/90">
              <li>
                <code className="font-mono text-[12px]">Authorization: Bearer &lt;token&gt;</code>
              </li>
              <li>Clerk, Auth.js, or any provider that issues JWTs</li>
            </ul>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50/60 p-3 dark:border-red-900/60 dark:bg-red-950/20">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Doesn&apos;t work</p>
            <ul className="mt-2 space-y-1 text-sm text-red-700 dark:text-red-100/90">
              <li>Supabase client with an anon key</li>
              <li>Direct PostgREST credentials</li>
              <li>Unauthenticated requests (unless explicitly allowed by policy)</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          6. Common errors
        </h2>
        <div className="mt-3 space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
          <div>
            <h3 className="font-medium text-zinc-800 dark:text-zinc-200">401 Unauthorized</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Token is missing or was not included in the request</li>
              <li>Token has expired — fetch a fresh one from your auth provider</li>
              <li>Wrong JWT template — make sure your auth provider is configured for Flux</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-zinc-800 dark:text-zinc-200">403 Forbidden</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Row-level security policies are blocking the request</li>
              <li>The database role does not have the required permissions on that table</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-zinc-800 dark:text-zinc-200">Empty response</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>The table exists but has no rows yet</li>
              <li>Your filter conditions did not match any rows</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8 pb-10">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          7. Next steps
        </h2>
        <ul className="mt-3 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            Store your Service URL in an environment variable (e.g.{" "}
            <code className="font-mono text-[12px] text-zinc-700 dark:text-zinc-300">
              NEXT_PUBLIC_FLUX_URL
            </code>
            )
          </li>
          <li>Use your auth provider to obtain fresh tokens — avoid hardcoding them</li>
          <li>
            Wrap your requests in a shared helper so auth headers stay in one place:
          </li>
        </ul>
        <div className="mt-3">
          <CodeBlock code={helperExample} label="ts" language="ts" />
        </div>
        <p className="mt-5 text-sm text-zinc-500 dark:text-zinc-400">
          Back to{" "}
          <Link
            href="/docs"
            className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
          >
            Documentation
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
