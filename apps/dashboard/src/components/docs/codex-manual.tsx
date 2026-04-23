import Link from "next/link";
import { FLUX_CODEX_JSON } from "@/src/lib/flux-codex-static";
import { CodeBlock } from "./code-block";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const navItem =
  "block w-full rounded-sm border border-transparent py-1.5 pl-0 text-left font-mono text-[11px] text-zinc-500 transition-[color,border-color] hover:border-zinc-800 hover:bg-zinc-900/30 hover:text-zinc-200 dark:hover:border-zinc-700/80";

const installSnippet = `curl -sL https://flux.vsl-base.com/install | bash

# Optional: self-hosted dashboard
# FLUX_ORIGIN=https://your-host curl -sL $FLUX_ORIGIN/install | bash

# Optional: install directory (default: ~/.local/bin)
# curl -sL https://flux.vsl-base.com/install | bash -s /usr/local/bin`;

const envSnippet = `export FLUX_API_BASE="https://flux.vsl-base.com/api"
export FLUX_API_TOKEN="flx_live_…"`;

const loginSnippet = `flux login`;

const createSnippet = `flux create "my-app"`;

const navIds = [
  { id: "install", label: "Installation" },
  { id: "authentication", label: "Authentication" },
  { id: "create", label: "Create a project" },
  { id: "accessing-data", label: "Accessing data" },
  { id: "managing", label: "Managing projects" },
  { id: "advanced", label: "Advanced" },
] as const;

function DocNav() {
  return (
    <nav className="lg:sticky lg:top-24" aria-label="On this page">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        On this page
      </p>
      <ul className="mt-3 space-y-0.5">
        {navIds.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className={`${navItem} ${focus}`}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CodexManual() {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)] lg:items-start lg:gap-10 xl:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] xl:gap-14">
      <div className="mb-8 border-b border-zinc-200 pb-4 lg:mb-0 lg:border-0 lg:pb-0 dark:border-zinc-800">
        <div className="lg:hidden">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            On this page
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-600 dark:text-zinc-500">
            {navIds.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`${focus} rounded-sm hover:text-zinc-900 dark:hover:text-zinc-300`}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="hidden lg:block">
          <DocNav />
        </div>
      </div>

      <div className="min-w-0 space-y-14 text-zinc-800 dark:text-zinc-300">
        <section id="install" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Installation
          </h2>
          <p className="mt-1 font-sans text-sm font-medium text-zinc-700 dark:text-zinc-200">
            The curl command
          </p>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            You need{" "}
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              Node.js 20+
            </strong>{" "}
            and <code className="text-zinc-700 dark:text-zinc-300">curl</code>.
            The installer puts <code className="text-zinc-700 dark:text-zinc-300">flux</code> in{" "}
            <code className="text-zinc-700 dark:text-zinc-300">~/.local/bin</code> by default. Add
            that folder to your <code className="text-zinc-700 dark:text-zinc-300">PATH</code> if the
            shell cannot find <code className="text-zinc-700 dark:text-zinc-300">flux</code>.
          </p>
          <div className="mt-4">
            <CodeBlock code={installSnippet} label="bash" />
          </div>
          <p className="mt-3 font-sans text-sm text-zinc-500">
            Example:{" "}
            <code className="text-zinc-600 dark:text-zinc-500">
              export PATH=&quot;$HOME/.local/bin:$PATH&quot;
            </code>
          </p>
          <p className="mt-2 font-sans text-sm text-zinc-500">
            If the install URL returns{" "}
            <span className="text-zinc-600 dark:text-zinc-400">503</span>, the host must build the
            CLI bundle before building the dashboard (
            <code className="text-zinc-600 dark:text-zinc-500">pnpm --filter @flux/cli run build</code>
            ).
          </p>
        </section>

        <section id="authentication" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Authentication
          </h2>
          <p className="mt-1 font-sans text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Running <code className="text-zinc-600 dark:text-zinc-400">flux login</code>
          </p>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Create an API key in{" "}
            <Link
              href="/settings/keys"
              className={`text-zinc-800 underline-offset-2 transition-colors duration-200 hover:underline dark:text-zinc-200 ${focus} rounded-sm`}
            >
              Settings → API keys
            </Link>
            . Then point the CLI at your dashboard API and token:
          </p>
          <div className="mt-4">
            <CodeBlock code={envSnippet} label="env" />
          </div>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Check that the key works:
          </p>
          <div className="mt-3">
            <CodeBlock code={loginSnippet} label="bash" />
          </div>
          <p className="mt-3 text-sm text-zinc-500">
            Self-host: set{" "}
            <code className="text-zinc-600 dark:text-zinc-500">FLUX_API_BASE</code> to your site
            origin plus <code className="text-zinc-600 dark:text-zinc-500">/api</code> (no trailing
            slash).
          </p>
        </section>

        <section id="create" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Creating a project
          </h2>
          <p className="mt-1 font-sans text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Running <code className="text-zinc-600 dark:text-zinc-400">flux create</code>
          </p>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            This provisions an isolated Postgres database and a PostgREST container for your app.
            Flux prints connection details when it finishes.
          </p>
          <div className="mt-4">
            <CodeBlock code={createSnippet} label="bash" />
          </div>
          <p className="mt-3 font-sans text-sm text-zinc-500">
            Apply a SQL file with{" "}
            <code className="text-zinc-600 dark:text-zinc-500">flux push ./schema.sql</code>. List
            projects with <code className="text-zinc-600 dark:text-zinc-500">flux list</code>.
          </p>
        </section>

        <section id="accessing-data" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Accessing data
          </h2>
          <p className="mt-1 font-sans text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Using the provided API URL
          </p>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            After <code className="text-zinc-700 dark:text-zinc-300">flux create</code>, use the
            HTTPS URL Flux gives you as your app&apos;s base URL. It speaks PostgREST: tables in the{" "}
            <code className="text-zinc-700 dark:text-zinc-300">public</code> schema become JSON
            endpoints. Send the anon (or service) API key your client needs in the{" "}
            <code className="text-zinc-700 dark:text-zinc-300">apikey</code> header (or configure
            PostgREST auth the way your stack expects).
          </p>
          <p className="mt-3 font-sans text-sm text-zinc-500">
            From the browser or server, call that URL like any REST API—for example list rows with{" "}
            <code className="text-zinc-600 dark:text-zinc-500">GET /your_table</code>.
          </p>
        </section>

        <section id="managing" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Managing projects
          </h2>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Flux separates <strong className="text-zinc-800 dark:text-zinc-200">power</strong>{" "}
            (stop/start—containers off or on, data usually kept) from{" "}
            <strong className="text-zinc-800 dark:text-zinc-200">destructive</strong> actions
            (repair or delete), which can wipe data or remove the project entirely.
          </p>
          <dl className="mt-5 space-y-4 border-t border-zinc-200/80 pt-4 dark:border-zinc-800/80">
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Stop
              </dt>
              <dd className="mt-1.5 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Stops API then database. Data stays on disk until you start again.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Start
              </dt>
              <dd className="mt-1.5 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Brings the same stack back online. Does not create a brand-new project from scratch.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-amber-600/90 dark:text-amber-400/90">
                Repair
              </dt>
              <dd className="mt-1.5 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Rebuilds the tenant when the stack is broken or missing. Treat this as a fresh empty
                database for that project slug.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-red-600/90 dark:text-red-400/80">
                Nuke
              </dt>
              <dd className="mt-1.5 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Removes containers, volumes, and the project row. Cannot be undone.
              </dd>
            </div>
          </dl>
          <p className="mt-4 font-sans text-sm text-zinc-500">
            Export SQL anytime with{" "}
            <code className="text-zinc-600 dark:text-zinc-500">flux dump</code> (see flags in
            Advanced).
          </p>
        </section>

        <section id="advanced" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Advanced
          </h2>
          <p className="mt-1 font-sans text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Core rules: hashes and passwords
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Docker names follow{" "}
            <code className="text-zinc-700 dark:text-zinc-300">
              {FLUX_CODEX_JSON.hashingConvention.pattern}
            </code>
            : you choose the slug; the control plane assigns a short hex id used in hostnames and
            container names.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {FLUX_CODEX_JSON.deterministicPassword.summary}
          </p>
          <p className="mt-4 text-sm text-zinc-500">
            Machine-readable reference:{" "}
            <a
              href="/api/cli/v1/codex"
              className="text-zinc-700 underline-offset-2 transition-colors duration-200 hover:underline dark:text-zinc-400"
            >
              GET /api/cli/v1/codex
            </a>
          </p>
          <p className="mt-6 font-sans text-sm font-medium text-zinc-700 dark:text-zinc-200">
            <code className="text-zinc-600 dark:text-zinc-400">flux dump</code> flags
          </p>
          <dl className="mt-3 space-y-3 border-t border-zinc-200/80 pt-3 dark:border-zinc-800/80">
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                --schema-only
              </dt>
              <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Schema only (<code className="text-zinc-700 dark:text-zinc-300">pg_dump -s</code>).
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                --data-only
              </dt>
              <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Data only (<code className="text-zinc-700 dark:text-zinc-300">pg_dump -a</code>).
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                --clean
              </dt>
              <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Adds drop statements for replay (<code className="text-zinc-700 dark:text-zinc-300">pg_dump -c --if-exists</code>).
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                --public-only
              </dt>
              <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Only the <code className="text-zinc-700 dark:text-zinc-300">public</code> schema (
                <code className="text-zinc-700 dark:text-zinc-300">pg_dump -n public</code>).
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
