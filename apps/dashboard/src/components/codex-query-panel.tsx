"use client";

import { readStreamableValue } from "ai/rsc";
import { useState, useTransition } from "react";
import type { queryCodexAction as QueryCodexAction } from "@/src/lib/actions";

type Props = {
  queryAction: typeof QueryCodexAction;
};

export function CodexQueryPanel({ queryAction }: Props) {
  const [query, setQuery] = useState("");
  const [output, setOutput] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = query.trim();
    if (!t || pending) return;
    startTransition(async () => {
      setOutput("");
      const stream = await queryAction(t);
      for await (const v of readStreamableValue(stream)) {
        if (v !== undefined && v !== null) {
          setOutput(String(v));
        }
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="p-4 sm:p-5">
      <label
        htmlFor="codex-query"
        className="block text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500"
      >
        Natural_language_interface
      </label>
      <input
        id="codex-query"
        type="search"
        name="q"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Query the Codex…"
        autoComplete="off"
        spellCheck={false}
        disabled={pending}
        className="mt-2 w-full border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-zinc-900 outline-none transition-[border-color,box-shadow] placeholder:text-zinc-400 focus:border-emerald-600/50 focus:ring-1 focus:ring-emerald-600/30 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-emerald-500/40 dark:focus:ring-emerald-500/25"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-200 transition-colors hover:border-emerald-600/60 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:border-emerald-500/50"
        >
          {pending ? "Streaming…" : "Submit_query"}
        </button>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-600">
          Workers AI:{" "}
          <code className="text-zinc-600 dark:text-zinc-500">
            @cf/meta/llama-3-8b-instruct
          </code>
        </span>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-600">
        Static reference:{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          GET /api/cli/v1/codex
        </code>
      </p>
      <div className="mt-4 min-h-[8rem] rounded border border-dashed border-zinc-200 bg-zinc-50/80 p-3 text-[12px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-200">
        {output ? (
          <pre
            className="whitespace-pre-wrap break-words text-[12px]"
            style={{ fontFamily: "var(--font-geist-mono)" }}
          >
            {output}
          </pre>
        ) : (
          <p
            className="text-[11px] text-zinc-500 dark:text-zinc-600"
            style={{ fontFamily: "var(--font-geist-mono)" }}
          >
            {pending
              ? "…"
              : "Response stream appears here (Geist Mono)."}
          </p>
        )}
      </div>
    </form>
  );
}
