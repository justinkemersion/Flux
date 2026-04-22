import Link from "next/link";
import { FLUX_CODEX_JSON } from "@/src/lib/flux-codex-static";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

export function CodexManual() {
  const cmds = FLUX_CODEX_JSON.commands;
  return (
    <div className="space-y-14 text-zinc-800 dark:text-zinc-300">
      <nav
        className="border-b border-zinc-200 pb-4 dark:border-zinc-800"
        aria-label="On this page"
      >
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          On_this_page
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-600 dark:text-zinc-500">
          <li>
            <a href="#install" className={`${focus} rounded-sm hover:text-zinc-900 dark:hover:text-zinc-300`}>
              Install
            </a>
          </li>
          <li>
            <a
              href="#control-plane"
              className={`${focus} rounded-sm hover:text-zinc-900 dark:hover:text-zinc-300`}
            >
              Control_plane
            </a>
          </li>
          <li>
            <a href="#cli" className={`${focus} rounded-sm hover:text-zinc-900 dark:hover:text-zinc-300`}>
              CLI_API
            </a>
          </li>
          <li>
            <a
              href="#core-rules"
              className={`${focus} rounded-sm hover:text-zinc-900 dark:hover:text-zinc-300`}
            >
              Core_rules
            </a>
          </li>
        </ul>
      </nav>

      <section id="install" className="scroll-mt-8">
        <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
          Install
        </h2>
        <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          The published CLI is a single Node (ESM) entry with a shebang. You need{" "}
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">Node.js 20+</strong>{" "}
          and <code className="text-zinc-700 dark:text-zinc-300">curl</code> on your PATH.
        </p>
        <div className="mt-4 overflow-x-auto border border-zinc-200 bg-zinc-50/80 p-4 font-mono text-[12px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
          <pre className="whitespace-pre text-[12px]">{`curl -sL https://flux.vsl-base.com/install | bash

# Optional: override origin (e.g. self-host)
# FLUX_ORIGIN=https://flux.vsl-base.com curl -sL $FLUX_ORIGIN/install | bash

# Optional: install directory (default: ~/.local/bin)
# curl -sL https://flux.vsl-base.com/install | bash -s /usr/local/bin`}</pre>
        </div>
        <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Ensure the install directory is on your <code className="text-zinc-700 dark:text-zinc-300">PATH</code>{" "}
          (e.g. add <code className="text-zinc-700 dark:text-zinc-300">export PATH=&quot;$HOME/.local/bin:$PATH&quot;</code>{" "}
          to your shell profile).
        </p>
        <p className="mt-2 font-sans text-sm text-zinc-500">
          <Link
            href="/"
            className="text-zinc-700 underline-offset-2 transition-colors duration-200 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Home
          </Link>{" "}
          mirrors the same one-liner under <code className="text-zinc-600 dark:text-zinc-500">#install</code>.
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
        <div className="mt-4 overflow-x-auto border border-zinc-200 bg-zinc-50/80 p-4 font-mono text-[12px] text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
          <pre className="whitespace-pre text-[12px]">{`export FLUX_API_BASE="https://flux.vsl-base.com/api"
export FLUX_API_TOKEN="flx_live_…"`}</pre>
        </div>
        <p className="mt-3 text-sm text-zinc-500">
          Self-host: set <code className="text-zinc-600 dark:text-zinc-500">FLUX_API_BASE</code> to
          your dashboard origin + <code className="text-zinc-600 dark:text-zinc-500">/api</code> (no
          trailing slash).
        </p>
      </section>

      <section id="cli" className="scroll-mt-8">
        <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
          CLI ↔ API
        </h2>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Authenticated with <code className="text-zinc-700 dark:text-zinc-300">Authorization: Bearer</code>. Summary:
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
                  <td className="p-2 text-emerald-600/90 dark:text-emerald-400/90">flux {name}</td>
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
          If <code className="text-zinc-600 dark:text-zinc-500">curl</code> to the CLI bundle
          returns 503, the host must run{" "}
          <code className="text-zinc-600 dark:text-zinc-500">pnpm --filter @flux/cli run build</code> before{" "}
          <code className="text-zinc-600 dark:text-zinc-500">next build</code>.
        </p>
      </section>

      <section id="core-rules" className="scroll-mt-8">
        <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
          Core_rules
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Naming: <code className="text-zinc-700 dark:text-zinc-300">{FLUX_CODEX_JSON.hashingConvention.pattern}</code>{" "}
          for tenant Docker stacks. Dev passwords may be HMAC-derived; production passwords are
          read from the running engine when needed.
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
  );
}
