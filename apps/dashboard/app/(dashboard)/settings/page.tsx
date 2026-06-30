import Link from "next/link";

export const runtime = "nodejs";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

export default function SettingsPage() {
  return (
    <div>
      <header className="mb-8">
        <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Manage CLI credentials and scoped MCP server tokens for agents and automation.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/settings/keys"
          className={`rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/50 ${focus}`}
        >
          <h2 className="text-sm font-semibold text-zinc-100">API Keys</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Bearer tokens for the Flux CLI and control-plane API. Export{" "}
            <code className="font-mono text-zinc-400">FLUX_API_TOKEN</code> locally.
          </p>
        </Link>
        <Link
          href="/settings/mcp-tokens"
          className={`rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/50 ${focus}`}
        >
          <h2 className="text-sm font-semibold text-zinc-100">MCP Tokens</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Scoped tokens for MCP agents — project allowlists, capability bundles, and audit trails.
          </p>
        </Link>
      </div>
    </div>
  );
}
