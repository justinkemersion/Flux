import Link from "next/link";
import { FLUX_CODEX_JSON } from "@/src/lib/flux-codex-static";
import { CodeBlock } from "./code-block";
import {
  docsBody,
  docsDlTerm,
  docsDlTermMono,
  docsDivider,
  docsFlagTerm,
  docsFocus,
  docsInlineCode,
  docsMuted,
  docsNavLabel,
  docsProseLink,
  docsSectionTitle,
  docsSubsectionTitle,
} from "./docs-styles";

const navItem = `block w-full rounded-sm border border-transparent py-1.5 pl-0 text-left text-sm text-zinc-500 transition-[color,border-color] hover:border-zinc-200 hover:bg-zinc-50/60 hover:text-zinc-800 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/30 dark:hover:text-zinc-200 ${docsFocus}`;

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
      <p className={docsNavLabel}>On this page</p>
      <ul className="mt-3 space-y-0.5">
        {navIds.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className={navItem}>
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
    <div className="lg:grid lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] lg:items-start lg:gap-12 xl:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] xl:gap-16">
      <div className="mb-8 border-b border-zinc-200 pb-4 lg:mb-0 lg:border-0 lg:pb-0 dark:border-zinc-800">
        <div className="lg:hidden">
          <p className={docsNavLabel}>On this page</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            {navIds.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`${docsFocus} rounded-sm transition-colors hover:text-zinc-900 dark:hover:text-zinc-200`}
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

      <div className="min-w-0 space-y-16">

        <section id="install" className="scroll-mt-10">
          <h2 className={docsSectionTitle}>Installation</h2>
          <p className={`mt-3 ${docsBody}`}>
            You need{" "}
            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
              Node.js 20 or later
            </strong>{" "}
            and <code className={docsInlineCode}>curl</code>. The installer puts{" "}
            <code className={docsInlineCode}>flux</code> in{" "}
            <code className={docsInlineCode}>~/.local/bin</code> by default. If your shell cannot find{" "}
            <code className={docsInlineCode}>flux</code>, add that directory to your{" "}
            <code className={docsInlineCode}>PATH</code>:
          </p>
          <div className="mt-4">
            <CodeBlock code={installSnippet} label="bash" />
          </div>
          <p className={`mt-3 ${docsMuted}`}>
            Example:{" "}
            <code className={docsInlineCode}>export PATH=&quot;$HOME/.local/bin:$PATH&quot;</code>
          </p>
        </section>

        <section id="authentication" className="scroll-mt-10">
          <h2 className={docsSectionTitle}>Authentication</h2>
          <p className={`mt-3 ${docsBody}`}>
            Create an API key in{" "}
            <Link href="/settings/keys" className={docsProseLink}>
              Settings → API keys
            </Link>
            . Set two environment variables so the CLI knows where to connect and how to authenticate:
          </p>
          <div className="mt-4">
            <CodeBlock code={envSnippet} label="env" />
          </div>
          <p className={`mt-3 ${docsBody}`}>Verify the connection:</p>
          <div className="mt-3">
            <CodeBlock code={loginSnippet} label="bash" />
          </div>
          <p className={`mt-3 ${docsMuted}`}>
            Self-hosted installs: set <code className={docsInlineCode}>FLUX_API_BASE</code> to your
            dashboard origin plus <code className={docsInlineCode}>/api</code> (no trailing slash).
          </p>
        </section>

        <section id="create" className="scroll-mt-10">
          <h2 className={docsSectionTitle}>Creating a project</h2>
          <p className={`mt-3 ${docsBody}`}>
            Run <code className={docsInlineCode}>flux create</code> to provision a Postgres database
            and REST API for your app. Flux prints connection details when it finishes.
          </p>
          <div className="mt-4">
            <CodeBlock code={createSnippet} label="bash" />
          </div>
          <p className={`mt-3 ${docsMuted}`}>
            Apply SQL with <code className={docsInlineCode}>flux push ./schema.sql</code>. List
            projects with <code className={docsInlineCode}>flux list</code>.
          </p>
        </section>

        <section id="accessing-data" className="scroll-mt-10">
          <h2 className={docsSectionTitle}>Accessing data</h2>
          <p className={`mt-3 ${docsBody}`}>
            After <code className={docsInlineCode}>flux create</code>, use the API URL from the output
            as your base URL. The API is a standard REST interface — call it from a browser, server,
            or CLI.
          </p>
          <dl className={`mt-5 space-y-5 pt-5 ${docsDivider}`}>
            <div>
              <dt className={docsDlTerm}>
                Dedicated stack{" "}
                <span className={docsDlTermMono}>
                  ({FLUX_CODEX_JSON.executionModesAndTiers.v1Dedicated.modeKey})
                </span>
              </dt>
              <dd className={`mt-2 ${docsBody}`}>
                Each project has its own database and API. Authenticate with project API credentials —
                typically an <code className={docsInlineCode}>anon</code> or{" "}
                <code className={docsInlineCode}>service_role</code> token, depending on how much trust
                you need.
              </dd>
            </div>
            <div>
              <dt className={`${docsDlTerm} text-emerald-800 dark:text-emerald-400`}>
                Pooled stack{" "}
                <span className={docsDlTermMono}>
                  ({FLUX_CODEX_JSON.executionModesAndTiers.v2Shared.modeKey})
                </span>
              </dt>
              <dd className={`mt-2 ${docsBody}`}>
                Use the Service URL with your app&apos;s auth tokens — no static database keys. Flux
                validates the token, identifies your project, and routes the request. See the{" "}
                <Link href="/docs/v2-first-request" className={docsProseLink}>
                  pooled stack guide
                </Link>{" "}
                for a full walkthrough.
              </dd>
            </div>
          </dl>
          <p className={`mt-4 ${docsMuted}`}>
            For example: <code className={docsInlineCode}>GET /your_table</code>.
          </p>
        </section>

        <section id="execution-modes" className="scroll-mt-10">
          <h2 className={docsSectionTitle}>Dedicated vs Pooled</h2>
          <p className={`mt-3 ${docsBody}`}>
            Flux supports two infrastructure models. Both use the same CLI and dashboard; the
            difference is how resources are arranged.{" "}
            <code className={docsInlineCode}>v1</code> and{" "}
            <code className={docsInlineCode}>v2</code> are internal engine identifiers, not a quality
            ranking.
          </p>
          <dl className={`mt-6 space-y-6 pt-6 ${docsDivider}`}>
            <div>
              <dt className={docsDlTerm}>
                Dedicated stack{" "}
                <span className={docsDlTermMono}>
                  ({FLUX_CODEX_JSON.executionModesAndTiers.v1Dedicated.modeKey})
                </span>
              </dt>
              <dd className={`mt-2 ${docsBody}`}>
                Each project gets its own Postgres instance and API container. Resources are not shared
                with other tenants. This is the strongest isolation boundary.
              </dd>
              <dd className={`mt-2 ${docsMuted}`}>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Good for:</span>{" "}
                workloads that need dedicated resources, regulated industries, or production apps where
                shared infrastructure is not acceptable.
              </dd>
            </div>
            <div>
              <dt className={`${docsDlTerm} text-emerald-800 dark:text-emerald-400`}>
                Pooled stack{" "}
                <span className={docsDlTermMono}>
                  ({FLUX_CODEX_JSON.executionModesAndTiers.v2Shared.modeKey})
                </span>
              </dt>
              <dd className={`mt-2 ${docsBody}`}>
                Multiple projects share a Postgres cluster. Each tenant is isolated at the schema and
                database-role level. A gateway handles authentication and routing.
              </dd>
              <dd className={`mt-2 ${docsMuted}`}>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Good for:</span> side
                projects, MVPs, and production apps that do not require dedicated stacks — lower cost
                and efficient resource use.
              </dd>
            </div>
          </dl>
        </section>

        <section id="tiers-plans" className="scroll-mt-10">
          <h2 className={docsSectionTitle}>Plans &amp; tiers</h2>
          <p className={`mt-3 ${docsBody}`}>
            Tiers describe where your data lives and what limits apply. Free and Pro run on the pooled
            stack; Enterprise defaults to dedicated stacks for stronger isolation.
          </p>
          <dl className={`mt-6 space-y-5 pt-6 ${docsDivider}`}>
            <div>
              <dt className={docsDlTerm}>
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.free.name}{" "}
                <span className={docsDlTermMono}>
                  ({FLUX_CODEX_JSON.executionModesAndTiers.tiers.free.engineMode})
                </span>
              </dt>
              <dd className={`mt-2 ${docsMuted}`}>
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.free.useCases}
              </dd>
            </div>
            <div>
              <dt className={docsDlTerm}>
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.pro.name}{" "}
                <span className={docsDlTermMono}>
                  ({FLUX_CODEX_JSON.executionModesAndTiers.tiers.pro.engineMode})
                </span>
              </dt>
              <dd className={`mt-2 ${docsMuted}`}>
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.pro.useCases}
              </dd>
            </div>
            <div>
              <dt className={docsDlTerm}>
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.enterprise.name}{" "}
                <span className={docsDlTermMono}>
                  ({FLUX_CODEX_JSON.executionModesAndTiers.tiers.enterprise.engineMode})
                </span>
              </dt>
              <dd className={`mt-2 ${docsMuted}`}>
                {FLUX_CODEX_JSON.executionModesAndTiers.tiers.enterprise.useCases}
              </dd>
            </div>
          </dl>
          <p className={`mt-6 ${docsMuted}`}>
            Simple rule: choose Enterprise when you need infrastructure fully separated from other
            projects. Otherwise start on Free and move to Pro as traffic grows.
          </p>
        </section>

        <section id="managing" className="scroll-mt-10">
          <h2 className={docsSectionTitle}>Managing projects</h2>
          <p className={`mt-3 ${docsBody}`}>
            Flux separates{" "}
            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
              routine operations
            </strong>{" "}
            (stop/start — containers off or on, data kept) from{" "}
            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
              destructive actions
            </strong>{" "}
            (reset, delete), which remove data or the project permanently.
          </p>
          <dl className={`mt-6 space-y-5 pt-6 ${docsDivider}`}>
            <div>
              <dt className={docsDlTerm}>Stop</dt>
              <dd className={`mt-2 ${docsBody}`}>
                Shuts down the API and database. Data stays on disk — use this to pause a project
                without losing anything.
              </dd>
            </div>
            <div>
              <dt className={docsDlTerm}>Start</dt>
              <dd className={`mt-2 ${docsBody}`}>
                Brings the project back with the same database and configuration. Does not create a new
                project from scratch.
              </dd>
            </div>
            <div>
              <dt className={`${docsDlTerm} text-amber-800 dark:text-amber-400`}>Repair</dt>
              <dd className={`mt-2 ${docsBody}`}>
                Reconciles the stack when something is out of sync (for example a container stopped
                unexpectedly). Restarts or recreates services without wiping database contents.
              </dd>
            </div>
            <div>
              <dt className={`${docsDlTerm} text-red-800 dark:text-red-400`}>
                Factory reset / Nuke
              </dt>
              <dd className={`mt-2 ${docsBody}`}>
                Factory reset wipes data and reprovisions an empty database. Nuke removes the project
                entirely — containers, volumes, and catalog row. Both are irreversible.
              </dd>
            </div>
          </dl>
          <p className={`mt-5 ${docsMuted}`}>
            Export anytime with <code className={docsInlineCode}>flux dump</code> (see Reference below).
          </p>
        </section>

        <section id="advanced" className="scroll-mt-10">
          <h2 className={docsSectionTitle}>Reference</h2>

          <h3 className={`mt-4 ${docsSubsectionTitle}`}>Project naming and identifiers</h3>
          <p className={`mt-3 ${docsBody}`}>
            Flux assigns a short identifier (hash) used in hostnames and resource names. Pattern:{" "}
            <code className={docsInlineCode}>{FLUX_CODEX_JSON.hashingConvention.pattern}</code>. You
            choose the slug; Flux assigns the hash.
          </p>
          <p className={`mt-3 ${docsBody}`}>
            Database passwords are derived from project identity and a server secret. You do not manage
            these directly — the control plane handles them.
          </p>

          <h3 className={`mt-8 ${docsSubsectionTitle}`}>
            <code className={docsInlineCode}>flux dump</code> flags
          </h3>
          <dl className={`mt-4 space-y-4 pt-4 ${docsDivider}`}>
            <div>
              <dt className={docsFlagTerm}>--schema-only</dt>
              <dd className={`mt-1.5 ${docsMuted}`}>Table definitions only — no row data.</dd>
            </div>
            <div>
              <dt className={docsFlagTerm}>--data-only</dt>
              <dd className={`mt-1.5 ${docsMuted}`}>Row data only — no definitions.</dd>
            </div>
            <div>
              <dt className={docsFlagTerm}>--clean</dt>
              <dd className={`mt-1.5 ${docsMuted}`}>
                Adds <code className={docsInlineCode}>DROP</code> before each{" "}
                <code className={docsInlineCode}>CREATE</code> so the dump can be replayed on an existing
                database.
              </dd>
            </div>
            <div>
              <dt className={docsFlagTerm}>--public-only</dt>
              <dd className={`mt-1.5 ${docsMuted}`}>
                Restricts export to the <code className={docsInlineCode}>public</code> schema only.
              </dd>
            </div>
          </dl>
        </section>

      </div>
    </div>
  );
}
