import Link from "next/link";
import { FLUX_MCP_CONNECT_HREF, FLUX_MCP_GUIDE_HREF } from "../data/landing-links";
import {
  cardClass,
  primaryCtaClass,
  secondaryCtaClass,
  sectionLabelClass,
  sectionTitleClass,
} from "./landing-ui";

const interfaces = [
  {
    title: "Dashboard",
    audience: "For humans",
    body: "Browse projects, inspect schemas, manage backups, run project doctor, and sync FLUX.md briefs in the browser.",
  },
  {
    title: "CLI",
    audience: "For operators",
    body: "Provision stacks, push migrations, and automate backup-aware workflows from the terminal — the same control plane MCP calls.",
  },
  {
    title: "MCP",
    audience: "For AI coding agents",
    body: "Cursor, Codex, Claude, and other MCP clients get structured, capability-scoped project context — inspect and plan by default.",
  },
] as const;

const workflowSteps = [
  "AI coding tool",
  "Flux MCP Server",
  "Flux Control Plane",
  "Project catalog · schema · backup trust · activity · docs",
] as const;

const examplePrompts = [
  "Inspect this project's schema and summarize missing tables.",
  "Check backup trust before applying this migration.",
  "Generate or refresh FLUX.md for this app.",
  "Run project doctor and explain what blocks deploy.",
] as const;

const monoStyle = {
  fontFamily: "var(--font-landing-mono), ui-monospace, monospace",
} as const;

export function AgentAccessSection() {
  return (
    <section
      id="agents"
      aria-labelledby="agents-heading"
      className="scroll-mt-24 text-left"
    >
      <p className={sectionLabelClass}>Agent access</p>
      <h2 id="agents-heading" className={sectionTitleClass}>
        Built for apps. Ready for agents.
      </h2>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
        Flux is a self-hosted Postgres backend and control plane with three interfaces. MCP exposes
        project state, schema inspection, backups, migration status, project doctor, activity, and
        FLUX.md context to AI tools through structured, permissioned project context — without
        replacing the dashboard or CLI.
      </p>

      <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
        {interfaces.map((item) => (
          <li key={item.title}>
            <article className={cardClass}>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                {item.audience}
              </p>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-zinc-100">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.body}</p>
            </article>
          </li>
        ))}
      </ul>

      <div className="mt-10">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
          MCP workflow
        </p>
        <div
          className="mt-4 flex flex-col gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/50 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
          style={monoStyle}
          aria-label="MCP workflow: AI coding tool through Flux MCP Server and control plane to project tools"
        >
          {workflowSteps.map((step, index) => (
            <span key={step} className="flex items-center gap-2 text-xs text-zinc-400 sm:gap-3">
              {index > 0 ? (
                <span className="hidden text-zinc-600 sm:inline" aria-hidden>
                  →
                </span>
              ) : null}
              {index > 0 ? (
                <span className="text-zinc-600 sm:hidden" aria-hidden>
                  ↓
                </span>
              ) : null}
              <span className="rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 leading-snug text-zinc-300">
                {step}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
          Example prompts
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {examplePrompts.map((prompt) => (
            <li key={prompt}>
              <blockquote
                className="h-full rounded-md border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm leading-relaxed text-zinc-400"
                style={monoStyle}
              >
                &ldquo;{prompt}&rdquo;
              </blockquote>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-8 max-w-2xl text-sm leading-relaxed text-zinc-500">
        Read-only and context tools are the default MCP posture. Migration apply requires scoped
        capabilities, restore-verified backup trust, and explicit confirmation — destructive
        lifecycle operations stay blocked. MCP never returns raw database passwords, pooled admin
        credentials, or long-lived JWT secrets.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
        <Link href={FLUX_MCP_CONNECT_HREF} className={primaryCtaClass}>
          Connect your AI tool
        </Link>
        <Link href={FLUX_MCP_GUIDE_HREF} className={secondaryCtaClass}>
          Read MCP guide
        </Link>
      </div>
    </section>
  );
}
