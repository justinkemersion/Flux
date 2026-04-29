"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { buildFluxAppDotEnvSnippet } from "@flux/core/standalone";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";

type PasswordSource = "container" | "derived" | "unavailable";

type ManifestPayload = {
  mode?: "v1_dedicated" | "v2_shared";
  apiUrl: string;
  postgresPassword: string;
  passwordSource: PasswordSource;
};

type Props = { slug: string };

function renderEnvPreview(block: string): ReactNode {
  return block.split("\n").map((line, idx) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) {
      return (
        <span key={`line-${String(idx)}`} className="block text-zinc-500">
          {line}
        </span>
      );
    }

    const eq = line.indexOf("=");
    if (eq <= 0) {
      return (
        <span key={`line-${String(idx)}`} className="block">
          {line}
        </span>
      );
    }

    const left = line.slice(0, eq);
    const right = line.slice(eq + 1);
    return (
      <span key={`line-${String(idx)}`} className="block">
        <span className="text-sky-300">{left}</span>
        <span className="text-zinc-400">=</span>
        <span className="text-emerald-300">{right}</span>
      </span>
    );
  });
}

function CopyBtn({
  text,
  idleLabel = "COPY",
  doneLabel = "COPIED",
  ariaLabel,
  title,
}: {
  text: string;
  idleLabel?: string;
  doneLabel?: string;
  ariaLabel?: string;
  title?: string;
}): ReactNode {
  const [done, setDone] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      /* */
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="shrink-0 border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300 hover:border-zinc-500"
      aria-label={ariaLabel}
      title={title}
    >
      {done ? doneLabel : idleLabel}
    </button>
  );
}

function RevealField({ value, emptyHint }: { value: string; emptyHint: string }): ReactNode {
  const [unlocked, setUnlocked] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!value) {
    return (
      <code className="block break-all pl-1 text-zinc-500">
        {emptyHint}
      </code>
    );
  }
  if (!unlocked) {
    if (!confirm) {
      return (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          <code className="text-zinc-500">••••••••</code>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="border border-amber-900/80 bg-amber-950/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-200/90 hover:border-amber-600"
          >
            REVEAL
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2 pl-1">
        <p className="font-mono text-[10px] text-zinc-500">
          Confirm: expose superuser password on this device.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setUnlocked(true);
              setConfirm(false);
            }}
            className="border border-zinc-600 bg-zinc-800 px-2 py-1 font-mono text-[10px] uppercase text-zinc-200 hover:border-zinc-400"
          >
            OK
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="border border-zinc-800 px-2 py-1 font-mono text-[10px] uppercase text-zinc-500 hover:border-zinc-600"
          >
            CANCEL
          </button>
        </div>
      </div>
    );
  }
  return (
    <code className="block break-all pl-1 text-zinc-200">{value}</code>
  );
}

/**
 * API URL and Postgres superuser — same derivation rules as core; copy + gated reveal.
 */
export function ProjectManifest({ slug }: Props) {
  const [data, setData] = useState<ManifestPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const envBlock = data?.apiUrl ? buildFluxAppDotEnvSnippet(data.apiUrl) : "";

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/manifest`,
        { cache: "no-store" },
      );
      const payload: unknown = await readResponseJson(res, {
        apiLabel: "project manifest API",
      });
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            payload,
            `load failed (${String(res.status)})`,
          ),
        );
      }
      setData(payload as ManifestPayload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="border border-zinc-800 bg-zinc-950/80 p-3">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        CONNECTION_MANIFEST
      </div>
      {err ? (
        <p className="mb-2 font-mono text-xs text-red-400">{err}</p>
      ) : null}
      <div className="space-y-3">
        <div>
          <p className="mb-1 font-mono text-[9px] uppercase text-zinc-600">
            POSTGREST API
          </p>
          <div className="flex min-w-0 items-start justify-between gap-2 border border-zinc-800 bg-black p-2">
            <code className="min-w-0 flex-1 break-all text-xs text-zinc-300">
              {data?.apiUrl ?? "—"}
            </code>
            {data?.apiUrl ? <CopyBtn text={data.apiUrl} /> : null}
          </div>
        </div>
        <div>
          <p className="mb-1 font-mono text-[9px] uppercase text-zinc-600">
            APP .ENV
          </p>
          <div className="flex min-w-0 items-start justify-between gap-2 border border-zinc-800 bg-black p-2">
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-zinc-300">
              {envBlock ? renderEnvPreview(envBlock) : "SYNC..."}
            </pre>
            {envBlock ? (
              <CopyBtn
                text={envBlock}
                idleLabel="COPY .ENV"
                doneLabel="COPIED .ENV"
                ariaLabel="Copy environment variables"
                title="Copy environment variables"
              />
            ) : null}
          </div>
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-[9px] uppercase text-zinc-600">
              POSTGRES_PASSWORD
            </p>
            {data?.passwordSource && data.passwordSource !== "unavailable" ? (
              <span className="font-mono text-[9px] uppercase text-zinc-600">
                {data.passwordSource === "container"
                  ? "SRC:CONTAINER"
                  : "SRC:HMAC_DERIVE"}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-start justify-between gap-2 border border-zinc-800 bg-black p-2">
            <div className="min-w-0 flex-1 text-xs">
              {data ? (
                <RevealField
                  value={data.postgresPassword}
                  emptyHint={
                    data.passwordSource === "unavailable"
                      ? data.mode === "v2_shared"
                        ? "Not shown for pooled tenants (no per-tenant Postgres container). Use the API URL with gateway JWTs."
                        : "Unavailable: start DB or set FLUX_PROJECT_PASSWORD_SECRET"
                      : "—"
                  }
                />
              ) : (
                <code className="text-zinc-500">SYNC…</code>
              )}
            </div>
            {data?.postgresPassword && data.passwordSource !== "unavailable" ? (
              <CopyBtn text={data.postgresPassword} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
