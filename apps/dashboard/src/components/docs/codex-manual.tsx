import Link from "next/link";
import { FLUX_CODEX_JSON } from "@/src/lib/flux-codex-static";
import { CodeBlock } from "./code-block";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const navItem =
  "block w-full rounded-sm border border-transparent py-1.5 pl-0 text-left text-sm text-zinc-500 transition-[color,border-color] hover:border-zinc-200 hover:bg-zinc-50/60 hover:text-zinc-800 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/30 dark:hover:text-zinc-200";

const installSnippet = `curl -sL https://flux.vsl-base.com/install | bash

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
  { id: "execution-modes", label: "Dedicated vs Pooled" },
  { id: "tiers-plans", label: "Plans & tiers" },
  { id: "managing", label: "Managing projects" },
  { id: "advanced", label: "Reference" },
] as const;

function DocNav() {
  return (
    <nav className="lg:sticky lg:top-24" aria-label="On this page">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
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
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
            On this page
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-500">
            {navIds.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`${focus} rounded-sm hover:text-zinc-800 dark:hover:text-zinc-300`}
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

        {/* ── Installation ─────────────────────────────────────────── */}
        <section id="install" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Installation
          </h2>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Install the CLI
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            You need{" "}
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              Node.js 20 or later
            </strong>{" "}
            and <code className="font-mono text-zinc-700 dark:text-zinc-300">curl</code>.
            The installer places the <code className="font-mono text-zinc-700 dark:text-zinc-300">flux</code>{" "}
            binary in <code className="font-mono text-zinc-700 dark:text-zinc-300">~/.local/bin</code> by default.
            If your shell cannot find <code className="font-mono text-zinc-700 dark:text-zinc-300">flux</code> after
            installation, add that directory to your <code className="font-mono text-zinc-700 dark:text-zinc-300">PATH</code>:
          </p>
          <div className="mt-4">
            <CodeBlock code={installSnippet} label="bash" />
          </div>
          <p className="mt-3 text-sm text-zinc-500">
            Example:{" "}
            <code className="font-mono text-zinc-500 dark:text-zinc-500">
              export PATH=&quot;$HOME/.local/bin:$PATH&quot;
            </code>
          </p>
        </section>

        {/* ── Authentication ───────────────────────────────────────── */}
        <section id="authentication" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Authentication
          </h2>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Connect the CLI to your account
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Create an API key in{" "}
            <Link
              href="/settings/keys"
              className={`text-zinc-800 underline-offset-2 transition-colors duration-200 hover:underline dark:text-zinc-200 ${focus} rounded-sm`}
            >
              Settings → API keys
            </Link>
            . Then set two environment variables so the CLI knows where to connect and how to authenticate:
          </p>
          <div className="mt-4">
            <CodeBlock code={envSnippet} label="env" />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Verify the connection:
          </p>
          <div className="mt-3">
            <CodeBlock code={loginSnippet} label="bash" />
          </div>
          <p className="mt-3 text-sm text-zinc-500">
            Self-hosted installs: set{" "}
            <code className="font-mono text-zinc-500">FLUX_API_BASE</code> to your
            dashboard origin plus <code className="font-mono text-zinc-500">/api</code> (no trailing slash).
          </p>
        </section>

        {/* ── Create a project ─────────────────────────────────────── */}
        <section id="create" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Creating a project
          </h2>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Running <code className="font-mono text-zinc-600 dark:text-zinc-400">flux create</code>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            This provisions a Postgres database and a REST API for your app. Flux prints the
            connection details when it finishes.
          </p>
          <div className="mt-4">
            <CodeBlock code={createSnippet} label="bash" />
          </div>
          <p className="mt-3 text-sm text-zinc-500">
            Push a SQL file with{" "}
            <code className="font-mono text-zinc-500">flux push ./schema.sql</code>. List your
            projects with <code className="font-mono text-zinc-500">flux list</code>.
          </p>
        </section>

        {/* ── Accessing data ───────────────────────────────────────── */}
        <section id="accessing-data" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Accessing data
          </h2>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Using your project&apos;s API URL
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            After <code className="font-mono text-zinc-700 dark:text-zinc-300">flux create</code>,
            use the API URL printed in the output as your base URL. The API is a standard REST
            interface — query it from a browser, server, or command line.
          </p>
          <dl className="mt-4 space-y-4 border-t border-zinc-200/80 pt-4 dark:border-zinc-800/80">
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Dedicated stack{" "}
                <span className="normal-case tracking-normal text-zinc-400">
                  ({FLUX_CODEX_JSON.executionModesAndTiers.v1Dedicated.modeKey})
                </span>
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Each project has its own database and API. Authenticate using the project API
                credentials — typically an <code className="font-mono text-zinc-700 dark:text-zinc-300">anon</code> or{" "}
                <code className="font-mono text-zinc-700 dark:text-zinc-300">service_role</code> token
                depending on how much trust you need.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-600/90 dark:text-emerald-400/85">
                Pooled stack{" "}
                <span className="normal-case tracking-normal text-zinc-400">
                  ({FLUX_CODEX_JSON.executionModesAndTiers.v2Shared.modeKey})
                </span>
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Use the Service URL with your app&apos;s auth tokens — no static database keys.
                Flux validates the token, identifies your project, and routes the request to the
                right data. See the{" "}
                <Link
                  href="/docs/v2-first-request"
                  className={`text-zinc-800 underline-offset-2 transition-colors hover:underline dark:text-zinc-200 ${focus} rounded-sm`}
                >
                  pooled stack guide
                </Link>{" "}
                for a full walkthrough.
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-zinc-500">
            From browser or server code, call the API like any REST endpoint — for
            example, <code className="font-mono text-zinc-500">GET /your_table</code>.
          </p>
        </section>

        {/* ── Dedicated vs Pooled ──────────────────────────────────── */}
        <section id="execution-modes" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Dedicated vs Pooled
          </h2>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Two infrastructure models, one CLI
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Flux supports two ways to run a project. Both use the same CLI and dashboard — the
            difference is how the underlying infrastructure is arranged.{" "}
            <code className="font-mono text-zinc-700 dark:text-zinc-300">v1</code> and{" "}
            <code className="font-mono text-zinc-700 dark:text-zinc-300">v2</code> are internal
            engine identifiers, not a quality ranking.
          </p>
          <dl className="mt-6 space-y-5 border-t border-zinc-200/80 pt-5 dark:border-zinc-800/80">
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Dedicated stack{" "}
                <span className="normal-case tracking-normal text-zinc-400">
                  ({FLUX_CODEX_JSON.executionModesAndTiers.v1Dedicated.modeKey})
                </span>
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Each project gets its own Postgres instance and its own API container. Resources
                are not shared with other projects. This is the strongest isolation boundary.
              </dd>
              <dd className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-500">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Good for: </span>
                workloads that require dedicated resources, regulated industries, or large
                production apps where shared infrastructure is not acceptable.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-600/90 dark:text-emerald-400/85">
                Pooled stack{" "}
                <span className="normal-case tracking-normal text-zinc-400">
                  ({FLUX_CODEX_JSON.executionModesAndTiers.v2Shared.modeKey})
                </span>
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Multiple projects share a Postgres cluster. Each project is isolated at the
                database schema and role level — your tables are not accessible to other tenants.
                A lightweight gateway handles authentication and routing.
              </dd>
              <dd className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-500">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Good for: </span>
                side projects, MVPs, and production apps that do not require dedicated
                infrastructure. More resource-efficient, lower cost.
              </dd>
            </div>
          </dl>
        </section>

        {/* ── Plans & tiers ────────────────────────────────────────── */}
        <section id="tiers-plans" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Plans &amp; tiers
          </h2>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Free, Pro, and Enterprise
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Tiers define where your data lives and what resource limits apply. Free and Pro run
            on the pooled stack. Enterprise defaults to a dedicated stack for stronger
            isolation.
          </p>
          <dl className="mt-6 space-y-4 border-t border-zinc-200/80 pt-5 dark:border-zinc-800/80">
            <div>
              <dt className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.free.name}{" "}
                <span className="font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
                  ({FLUX_CODEX_JSON.executionModesAndTiers.tiers.free.engineMode})
                </span>
              </dt>
              <dd className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.free.useCases}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.pro.name}{" "}
                <span className="font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
                  ({FLUX_CODEX_JSON.executionModesAndTiers.tiers.pro.engineMode})
                </span>
              </dt>
              <dd className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.pro.useCases}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.enterprise.name}{" "}
                <span className="font-mono text-[10px] font-normal tracking-[0.06em] text-zinc-400 dark:text-zinc-500">
                  ({FLUX_CODEX_JSON.executionModesAndTiers.tiers.enterprise.engineMode})
                </span>
              </dt>
              <dd className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.enterprise.useCases}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-500">
            A simple rule: if you need resources that are fully separated from other projects,
            choose Enterprise. Otherwise, start on Free and upgrade to Pro as your traffic grows.
          </p>
        </section>

        {/* ── Managing projects ────────────────────────────────────── */}
        <section id="managing" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Managing projects
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Flux separates <strong className="text-zinc-800 dark:text-zinc-200">power operations</strong>{" "}
            (stop/start — containers off or on, data kept) from{" "}
            <strong className="text-zinc-800 dark:text-zinc-200">destructive operations</strong>{" "}
            (reset, delete), which permanently remove data or the project itself.
          </p>
          <dl className="mt-5 space-y-4 border-t border-zinc-200/80 pt-4 dark:border-zinc-800/80">
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Stop
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Shuts down the API and database. Your data stays on disk. Use this to pause a
                project without losing anything.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Start
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Brings the project back online using the same database and configuration. This
                does not create a new project.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-amber-600/90 dark:text-amber-400/90">
                Repair
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Reconciles the project stack when something is out of sync — for example, if a
                container stopped unexpectedly. Repair restarts or recreates the affected
                services without touching the database contents.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-red-600/90 dark:text-red-400/80">
                Factory reset / Nuke
              </dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Factory reset wipes all data and reprovisions an empty database. Nuke removes the
                project entirely — containers, data, and the project record. Both are
                irreversible.
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-zinc-500">
            Export your data at any time with{" "}
            <code className="font-mono text-zinc-500">flux dump</code> (see flags in the
            Reference section below).
          </p>
        </section>

        {/* ── Reference ────────────────────────────────────────────── */}
        <section id="advanced" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Reference
          </h2>
          <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Project naming and identifiers
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            When you create a project, Flux generates a short identifier (hash) that is used
            internally in hostnames and resource names. The pattern is{" "}
            <code className="font-mono text-zinc-700 dark:text-zinc-300">
              {FLUX_CODEX_JSON.hashingConvention.pattern}
            </code>
            . You choose the slug; Flux assigns the hash.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Database passwords for each project are derived deterministically from the project
            identity and a server secret. You do not set or manage these passwords directly — the
            control plane handles them.
          </p>

          <p className="mt-6 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            <code className="font-mono text-zinc-600 dark:text-zinc-400">flux dump</code> flags
          </p>
          <dl className="mt-3 space-y-3 border-t border-zinc-200/80 pt-3 dark:border-zinc-800/80">
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                --schema-only
              </dt>
              <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Export table definitions only — no row data.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                --data-only
              </dt>
              <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Export row data only — no table definitions.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                --clean
              </dt>
              <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Includes <code className="font-mono text-zinc-700 dark:text-zinc-300">DROP</code> statements
                before each <code className="font-mono text-zinc-700 dark:text-zinc-300">CREATE</code>, so the
                dump can be replayed cleanly on an existing database.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                --public-only
              </dt>
              <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Restricts the export to the{" "}
                <code className="font-mono text-zinc-700 dark:text-zinc-300">public</code> schema only.
              </dd>
            </div>
          </dl>
        </section>

      </div>
    </div>
  );
}
