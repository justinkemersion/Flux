"use client";

type CodexStarter = {
  /** Button label (macro or sentence). */
  label: string;
  /** Text sent to the model. */
  query: string;
};

const STARTERS: CodexStarter[] = [
  { label: "How do I install the CLI?", query: "How do I install the CLI?" },
  {
    label: "How do I create my first database?",
    query: "How do I create my first database?",
  },
  {
    label: "How do I connect my app to Flux?",
    query: "How do I connect my app to Flux?",
  },
  {
    label: "Is the server running okay right now?",
    query: "Is the server running okay right now?",
  },
  {
    label: "[ HELP_ME_INSTALL ]",
    query:
      "Walk me through installing the Flux CLI from scratch, including PATH and authentication setup.",
  },
  {
    label: "[ EXPLAIN_DETERMINISM ]",
    query:
      "Explain how deterministic context injection works for Flux Codex and what guarantees it provides.",
  },
  {
    label: "[ SYSTEM_HEALTH_REPORT ]",
    query:
      "What should I check for a Flux system health report, including control plane, tenants, and Docker?",
  },
  {
    label: "[ DATA_EXPORT_GUIDE ]",
    query:
      "What is the recommended way to export or back up data from a Flux tenant PostgreSQL database?",
  },
  {
    label: "[ TIER_FREE ]",
    query:
      "Explain the Flux **Free** tier in plain, ordinary language. Where does it sit versus Pro and Enterprise in the tier hierarchy? What execution mode does it map to (v1_dedicated vs v2_shared)? What isolation do I actually get, what are sensible use cases, and what tradeoffs should I expect compared to the other tiers?",
  },
  {
    label: "[ TIER_PRO ]",
    query:
      "Explain the Flux **Pro** tier in plain, ordinary language. How is it different from Free and Enterprise in the hierarchy? Same execution path as Free or not? What extra guardrails exist, who is it for, and when would I step up to Enterprise instead?",
  },
  {
    label: "[ TIER_ENTERPRISE ]",
    query:
      "Explain the Flux **Enterprise** tier in plain, ordinary language. How does it differ from Free and Pro—especially isolation and compliance? What execution mode does it default to, what workloads belong here, and when is shared (v2) ever the wrong choice?",
  },
];

type Props = {
  disabled: boolean;
  onPick: (question: string) => void;
};

/**
 * One-tap prompts for the Codex panel (Geist Mono, zinc rack aesthetic).
 */
export function CodexSuggestions({ disabled, onPick }: Props) {
  return (
    <div
      className="mt-1 flex flex-wrap gap-2.5"
      role="group"
      aria-label="Diagnostic starters"
    >
      {STARTERS.map((s) => (
        <button
          key={s.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s.query)}
          className="rounded border border-emerald-900/30 bg-zinc-950 px-3 py-2 text-left text-[11px] font-medium leading-snug text-zinc-300 shadow-[0_0_0_1px_rgba(6,78,59,0.12)] transition-[border-color,background-color,color,box-shadow] hover:border-emerald-600/40 hover:bg-zinc-900/90 hover:text-emerald-100/90 hover:shadow-[0_0_16px_-6px_rgba(16,185,129,0.25)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-950/40 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-emerald-500/35 dark:hover:text-emerald-100/85"
          style={{ fontFamily: "var(--font-geist-mono)" }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
