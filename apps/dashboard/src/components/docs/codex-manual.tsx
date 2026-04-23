import Link from "next/link";
import { FLUX_CODEX_JSON } from "@/src/lib/flux-codex-static";
import { CodeBlock } from "./code-block";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const navItem =
  "block w-full rounded-sm border border-transparent py-1.5 pl-0 text-left font-mono text-[11px] text-zinc-500 transition-[color,border-color] hover:border-zinc-800 hover:bg-zinc-900/30 hover:text-zinc-200 dark:hover:border-zinc-700/80";

const installSnippet = `curl -sL https://flux.vsl-base.com/install | bash

# Optional: override origin (e.g. self-host)
# FLUX_ORIGIN=https://flux.vsl-base.com curl -sL $FLUX_ORIGIN/install | bash

# Optional: install directory (default: ~/.local/bin)
# curl -sL https://flux.vsl-base.com/install | bash -s /usr/local/bin`;

const envSnippet = `export FLUX_API_BASE="https://flux.vsl-base.com/api"
export FLUX_API_TOKEN="flx_live_…"`;

const navIds = [
  { id: "install", label: "Install" },
  { id: "control-plane", label: "Control_plane" },
  { id: "cli", label: "CLI_↔_API" },
  { id: "lifecycle-operations", label: "Lifecycle" },
  { id: "core-rules", label: "Core_rules" },
] as const;

function DocNav() {
  return (
    <nav
      className="lg:sticky lg:top-24"
      aria-label="On this page"
    >
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        On_this_page
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
  const cmds = FLUX_CODEX_JSON.commands;
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)] lg:items-start lg:gap-10 xl:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] xl:gap-14">
      <div className="mb-8 border-b border-zinc-200 pb-4 lg:mb-0 lg:border-0 lg:pb-0 dark:border-zinc-800">
        <div className="lg:hidden">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            On_this_page
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
            Install
          </h2>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            The published CLI is a single Node (ESM) entry with a shebang. You
            need{" "}
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              Node.js 20+
            </strong>{" "}
            and <code className="text-zinc-700 dark:text-zinc-300">curl</code> on
            your PATH.
          </p>
          <div className="mt-4">
            <CodeBlock code={installSnippet} label="bash" />
          </div>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Ensure the install directory is on your{" "}
            <code className="text-zinc-700 dark:text-zinc-300">PATH</code> (e.g. add{" "}
            <code className="text-zinc-700 dark:text-zinc-300">
              export PATH=&quot;$HOME/.local/bin:$PATH&quot;
            </code>{" "}
            to your shell profile).
          </p>
          <p className="mt-2 font-sans text-sm text-zinc-500">
            <Link
              href="/"
              className="text-zinc-700 underline-offset-2 transition-colors duration-200 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Home
            </Link>{" "}
            mirrors the same one-liner under{" "}
            <code className="text-zinc-600 dark:text-zinc-500">#install</code>.
          </p>
        </section>

        <section id="control-plane" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Control_plane
          </h2>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            The CLI talks to the dashboard API. Create a key under{" "}
            <Link
              href="/settings/keys"
              className={`text-zinc-800 underline-offset-2 transition-colors duration-200 hover:underline dark:text-zinc-200 ${focus} rounded-sm`}
            >
              Settings → API keys
            </Link>
            , then:
          </p>
          <div className="mt-4">
            <CodeBlock code={envSnippet} label="env" />
          </div>
          <p className="mt-3 text-sm text-zinc-500">
            Self-host: set{" "}
            <code className="text-zinc-600 dark:text-zinc-500">
              FLUX_API_BASE
            </code>{" "}
            to your dashboard origin +{" "}
            <code className="text-zinc-600 dark:text-zinc-500">/api</code> (no
            trailing slash).
          </p>
        </section>

        <section id="cli" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            CLI ↔ API
          </h2>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Authenticated with{" "}
            <code className="text-zinc-700 dark:text-zinc-300">
              Authorization: Bearer
            </code>
            . Summary:
          </p>
          <div className="mt-4 overflow-x-auto border border-zinc-800/60">
            <table className="w-full min-w-[28rem] border-collapse font-mono text-[11px] text-zinc-200">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="p-2 font-medium">Command</th>
                  <th className="p-2 font-medium">Control plane</th>
                </tr>
              </thead>
              <tbody className="text-zinc-400">
                {(
                  [
                    ["login", cmds.authVerify],
                    ["create", cmds.create],
                    ["list", cmds.list],
                    ["push", cmds.push],
                    ["logs", cmds.logs],
                  ] as const
                ).map(([name, desc]) => (
                  <tr key={name} className="border-b border-zinc-800/50">
                    <td className="p-2 text-emerald-600/90 dark:text-emerald-400/90">
                      flux {name}
                    </td>
                    <td className="p-2 text-zinc-500">{desc}</td>
                  </tr>
                ))}
                <tr>
                  <td className="p-2 text-zinc-500" colSpan={2}>
                    {cmds.reap}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-zinc-500">
            If <code className="text-zinc-600 dark:text-zinc-500">curl</code> to
            the CLI bundle returns 503, the host must run{" "}
            <code className="text-zinc-600 dark:text-zinc-500">
              pnpm --filter @flux/cli run build
            </code>{" "}
            before{" "}
            <code className="text-zinc-600 dark:text-zinc-500">next build</code>
            .
          </p>
        </section>

        <section id="lifecycle-operations" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Lifecycle_operations
          </h2>
          <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            The control plane and CLI distinguish four project-level operations. Use
            the one that matches intent: <strong className="font-medium text-zinc-800 dark:text-zinc-200">power</strong>{" "}
            (reversible) vs <strong className="font-medium text-zinc-800 dark:text-zinc-200">provision</strong> (destructive).
          </p>
          <dl className="mt-5 space-y-4 border-t border-zinc-200/80 pt-2 dark:border-zinc-800/80">
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Stop — <span className="text-zinc-400">Standby</span>
              </dt>
              <dd className="mt-1.5 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Stops the PostgREST and Postgres <strong>containers</strong> in
                order (API first, then database). <strong>Data</strong> remains on
                the named volume; the project is on standby, not decommissioned. Safe
                for cost or idle control.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Start — <span className="text-zinc-400">Operational</span>
              </dt>
              <dd className="mt-1.5 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Starts the same stack: database first, a short settle window, then
                the API container. The tenant serves HTTP again. Does not re-run
                provisioning; it <strong>resumes</strong> existing infrastructure.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-amber-600/90 dark:text-amber-400/90">
                Repair — <span className="text-amber-700/90 dark:text-amber-500/90">Destructive (data)</span>
              </dt>
              <dd className="mt-1.5 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Re-provisions the tenant <strong>from the environment</strong> when
                the stack is missing, partial, or drifted: removes and recreates
                containers and <strong>disk</strong> for that project. Assumes
                project metadata in the catalog is still valid. Use when you need a
                clean, empty database on the same slug/hash.
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-red-600/90 dark:text-red-400/80">
                Nuke — <span className="text-red-800/80 dark:text-red-400/70">Atomic_purge</span>
              </dt>
              <dd className="mt-1.5 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <strong>NUKE</strong> tears down <strong>all</strong> tenant
                infrastructure for the project (PostgREST, Postgres, named volume,
                per-tenant network), then removes the <strong>catalog</strong> row. It
                is atomic at the “nothing left in Docker and no DB row” level, and
                the operation is <strong>irreversible</strong> by design. Invoked
                from the API (session) with confirmation in UI, and from the CLI with
                explicit flags.
              </dd>
            </div>
          </dl>
        </section>

        <section id="core-rules" className="scroll-mt-8">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Core_rules
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Naming:{" "}
            <code className="text-zinc-700 dark:text-zinc-300">
              {FLUX_CODEX_JSON.hashingConvention.pattern}
            </code>{" "}
            for tenant Docker stacks. Dev passwords may be HMAC-derived; production
            passwords are read from the running engine when needed.
          </p>
          <p className="mt-3 text-sm text-zinc-500">
            Machine-readable Codex:{" "}
            <a
              href="/api/cli/v1/codex"
              className="text-zinc-700 underline-offset-2 transition-colors duration-200 hover:underline dark:text-zinc-400"
            >
              GET /api/cli/v1/codex
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
