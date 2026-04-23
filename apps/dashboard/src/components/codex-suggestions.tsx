"use client";

const STARTERS = [
  "How do I install the CLI?",
  "How do I create my first database?",
  "How do I connect my app to Flux?",
  "Is the server running okay right now?",
] as const;

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
      className="mt-3 flex flex-wrap gap-2"
      role="group"
      aria-label="Suggested questions"
    >
      {STARTERS.map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-left text-[11px] leading-snug text-zinc-400 transition-[border-color,background-color,color] hover:border-zinc-500 hover:bg-zinc-900/80 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
          style={{ fontFamily: "var(--font-geist-mono)" }}
        >
          {q}
        </button>
      ))}
    </div>
  );
}
