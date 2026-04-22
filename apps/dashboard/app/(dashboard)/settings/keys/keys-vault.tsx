"use client";

import { useCallback, useState, useTransition } from "react";
import { createApiKeyAction } from "./actions";

export type KeyVaultRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return iso;
  }
}

export function KeysVault({ initialRows }: { initialRows: KeyVaultRow[] }) {
  const [rows, setRows] = useState<KeyVaultRow[]>(initialRows);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = useCallback(
    (formData: FormData) => {
      setFormError(null);
      startTransition(() => {
        void (async () => {
          const result = await createApiKeyAction(formData);
          if (!result.ok) {
            setFormError(result.error);
            return;
          }
          setPlaintext(result.plaintext);
          setRows((prev) => [result.row, ...prev]);
        })();
      });
    },
    [],
  );

  return (
    <div className="space-y-8 text-center sm:text-left">
      <div>
        <h1 className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-zinc-300">
          Key_vault
        </h1>
        <p className="mx-auto mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-zinc-500">
          CLI and automation use Bearer tokens. Raw secrets are shown once at creation and are
          never stored; only a SHA-256 hash is kept. Export{" "}
          <span className="text-zinc-400">FLUX_API_TOKEN</span> locally and point{" "}
          <span className="text-zinc-400">FLUX_API_BASE</span> at this app&apos;s origin +{" "}
          <span className="text-zinc-400">/api</span>.
        </p>
      </div>

      <section
        className="border border-zinc-700 bg-zinc-900/30 p-4 sm:mx-0"
        aria-labelledby="new-key-heading"
      >
        <h2
          id="new-key-heading"
          className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 sm:text-left"
        >
          Issue_key
        </h2>
        <form
          className="mx-auto flex max-w-lg flex-col gap-3 sm:mx-0 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
              Label
            </span>
            <input
              name="name"
              type="text"
              placeholder="Default Key"
              autoComplete="off"
              className="border border-zinc-700 bg-zinc-950 px-2 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 border border-zinc-600 bg-zinc-950 px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-200 hover:border-zinc-500 hover:bg-zinc-900 disabled:opacity-50"
          >
            {pending ? "Working…" : "Generate"}
          </button>
        </form>
        {formError ? (
          <p className="mt-3 font-mono text-xs text-red-400" role="alert">
            {formError}
          </p>
        ) : null}
      </section>

      {plaintext ? (
        <section
          className="border border-amber-900/60 bg-amber-950/20 p-4"
          aria-live="polite"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200/90">
              New_secret — copy_now
            </span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(plaintext);
              }}
              className="border border-amber-800/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-100 hover:bg-amber-950/40"
            >
              Copy
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-amber-100/95">
            {plaintext}
          </pre>
          <p className="mt-2 font-mono text-[10px] text-amber-200/70">
            This string is not stored. Refresh clears this panel; the key remains in the list
            below as an opaque entry.
          </p>
          <button
            type="button"
            onClick={() => setPlaintext(null)}
            className="mt-3 border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 hover:border-zinc-500"
          >
            Dismiss_banner
          </button>
        </section>
      ) : null}

      <section
        className="text-left"
        aria-labelledby="vault-list-heading"
      >
        <h2
          id="vault-list-heading"
          className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 sm:text-left"
        >
          Keys_{rows.length}
        </h2>
        {rows.length === 0 ? (
          <p className="border border-zinc-800 bg-zinc-900/20 px-3 py-4 font-mono text-xs text-zinc-600">
            No keys yet. Generate one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((k) => (
              <li
                key={k.id}
                className={`border border-zinc-700 bg-zinc-900/20 p-3 font-mono text-[11px] leading-relaxed ${
                  k.revokedAt ? "opacity-50" : ""
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-zinc-300">{k.name}</span>
                  <span className="text-zinc-600">
                    {k.revokedAt ? "REVOKED" : "ACTIVE"}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-zinc-500 sm:grid-cols-2">
                  <div>
                    <span className="text-zinc-600">id </span>
                    <span className="break-all text-zinc-400">{k.id}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">prefix </span>
                    <span className="text-zinc-400">{k.keyPrefix}_…</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">created </span>
                    <span>{fmt(k.createdAt)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">last_used </span>
                    <span>{fmt(k.lastUsedAt)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
