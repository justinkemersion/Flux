"use client";

import { readStreamableValue } from "ai/rsc";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CodexSuggestions } from "@/src/components/codex-suggestions";
import type { queryCodexAction as QueryCodexAction } from "@/src/lib/actions";
import { CODEX_OFFLINE_TERMINAL_MESSAGE } from "@/src/lib/codex-offline-message";
import { CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE } from "@/src/lib/codex-inference-messages";

type Props = {
  queryAction: typeof QueryCodexAction;
};

const TYPE_MS = 22;

export function CodexQueryPanel({ queryAction }: Props) {
  const [query, setQuery] = useState("");
  const [output, setOutput] = useState("");
  const [pending, startTransition] = useTransition();
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    };
  }, []);

  const runQuery = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || pending) return;
      startTransition(async () => {
        setOutput("");
        try {
          const stream = await queryAction(t);
          for await (const v of readStreamableValue(stream)) {
            if (v !== undefined && v !== null) {
              setOutput(String(v));
            }
          }
        } catch (err) {
          console.error("[CodexQueryPanel] stream / action failed:", err);
          setOutput(CODEX_OFFLINE_TERMINAL_MESSAGE);
        }
      });
    },
    [pending, queryAction],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    runQuery(query);
  }

  function onSuggestionPick(question: string) {
    if (typeTimerRef.current) {
      clearInterval(typeTimerRef.current);
      typeTimerRef.current = null;
    }
    const full = question.trim();
    if (!full || pending) return;

    let i = 0;
    setQuery("");
    setOutput("");

    typeTimerRef.current = setInterval(() => {
      i += 1;
      setQuery(full.slice(0, i));
      if (i >= full.length) {
        if (typeTimerRef.current) clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
        setQuery(full);
        runQuery(full);
      }
    }, TYPE_MS);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="p-4 sm:p-5"
      style={{ fontFamily: "var(--font-geist-mono)" }}
    >
      <div className="mb-4 border-b border-zinc-800 pb-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400">
          Diagnostic Starters
        </p>
        <CodexSuggestions disabled={pending} onPick={onSuggestionPick} />
      </div>

      <label
        htmlFor="codex-query"
        className="sr-only"
      >
        Query Flux Intelligence
      </label>
      <input
        id="codex-query"
        type="search"
        name="q"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Query Flux Intelligence (AI)..."
        autoComplete="off"
        spellCheck={false}
        disabled={pending}
        className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-[12px] text-zinc-100 outline-none transition-[border-color,box-shadow] placeholder:text-zinc-600 focus:border-emerald-600/45 focus:ring-1 focus:ring-emerald-600/25 disabled:opacity-50 dark:focus:border-emerald-500/40 dark:focus:ring-emerald-500/20"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className="rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-200 transition-colors hover:border-emerald-600/55 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:border-emerald-500/45"
        >
          {pending ? "Streaming…" : "Submit_query"}
        </button>
      </div>
      <div className="mt-4 min-h-[8rem] border border-dashed border-zinc-800 bg-zinc-950/60 p-3 text-[12px] leading-relaxed text-zinc-200">
        {output ? (
          <pre
            className={
              output === CODEX_OFFLINE_TERMINAL_MESSAGE
                ? "whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-600"
                : output === CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE
                  ? "whitespace-pre-wrap break-words text-[11px] leading-relaxed text-amber-600/90"
                  : "whitespace-pre-wrap break-words text-[12px] text-zinc-200"
            }
          >
            {output}
          </pre>
        ) : (
          <p className="text-[11px] text-zinc-600">
            {pending ? "…" : "Response stream appears here (Geist Mono)."}
          </p>
        )}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-zinc-600/90">
        Codex is a resource-constrained component of the backbone—governed inference, not
        unbounded LLM access. Powered by Cloudflare Workers AI · deterministic context injection
      </p>
    </form>
  );
}
