import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/src/components/docs/code-block";

export const metadata: Metadata = {
  title: "Flux Pooled Stack: First Request Guide",
  description:
    "Get your first successful request working with Flux pooled stack projects.",
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
      <div className="border-b border-zinc-800 pb-5">
        <Link
          href="/projects"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-300"
        >
          ← Back to projects
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-zinc-100">
          Flux Pooled Stack: First Request Guide
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          You don&apos;t need API keys. Flux uses your app&apos;s auth tokens.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">1. Mental Model</h2>
        <ul className="mt-3 space-y-1 text-sm text-zinc-300">
          <li>Dedicated stack projects typically use static API key patterns.</li>
          <li>Pooled stack projects use your Service URL plus user auth tokens.</li>
          <li>There are no static anon/service keys in pooled stack projects.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">
          2. Your First Request
        </h2>
        <div className="mt-3">
          <CodeBlock code={firstRequest} label="ts" language="ts" />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">
          3. Use this in your app
        </h2>
        <div className="mt-3 space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">
              Browser (React / Next.js client)
            </h3>
            <CodeBlock code={browserExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">
              Server (Next.js route / server action)
            </h3>
            <CodeBlock code={serverExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">
              cURL (debugging)
            </h3>
            <CodeBlock code={curlExample} label="bash" language="bash" />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">
          4. Common patterns
        </h2>
        <div className="mt-3 space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">Insert</h3>
            <CodeBlock code={insertExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">Filter</h3>
            <CodeBlock code={filterExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">Update</h3>
            <CodeBlock code={updateExample} label="ts" language="ts" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">Delete</h3>
            <CodeBlock code={deleteExample} label="ts" language="ts" />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">
          5. What works vs doesn&apos;t work
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-emerald-900/60 bg-emerald-950/20 p-3">
            <p className="text-sm font-medium text-emerald-200">Works</p>
            <ul className="mt-2 space-y-1 text-sm text-emerald-100/90">
              <li>fetch with Authorization: Bearer token</li>
              <li>using your auth provider (Clerk, Auth.js, etc.)</li>
            </ul>
          </div>
          <div className="rounded-md border border-red-900/60 bg-red-950/20 p-3">
            <p className="text-sm font-medium text-red-200">Doesn&apos;t work</p>
            <ul className="mt-2 space-y-1 text-sm text-red-100/90">
              <li>Supabase client with anon key</li>
              <li>direct PostgREST credentials</li>
              <li>requests without auth (unless explicitly allowed)</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">6. Common errors</h2>
        <div className="mt-3 space-y-4 text-sm text-zinc-300">
          <div>
            <h3 className="font-medium text-zinc-100">401 Unauthorized</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>missing token</li>
              <li>expired token</li>
              <li>wrong auth template</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-zinc-100">403 Forbidden</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>permissions or policies blocking access</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-zinc-100">Empty response</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>no data in table</li>
              <li>filters don&apos;t match</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8 pb-10">
        <h2 className="text-lg font-semibold text-zinc-100">7. What&apos;s next</h2>
        <ul className="mt-3 space-y-1 text-sm text-zinc-300">
          <li>Store your Service URL in environment variables</li>
          <li>Use your auth provider to get tokens</li>
          <li>Wrap requests in a helper</li>
        </ul>
        <div className="mt-3">
          <CodeBlock code={helperExample} label="ts" language="ts" />
        </div>
      </section>
    </main>
  );
}
