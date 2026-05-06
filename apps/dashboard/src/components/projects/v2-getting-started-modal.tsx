"use client";

import { Check, Clipboard, ExternalLink, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CodeBlock } from "@/src/components/docs/code-block";

const GATEWAY_ENV_KEY = "FLUX_GATEWAY_JWT_SECRET";

function gatewayJwtDismissStorageKey(slug: string, hash: string): string {
  return `flux:v2-gateway-jwt-dismissed:${slug}:${hash}`;
}

type V2GettingStartedModalProps = {
  open: boolean;
  onClose: () => void;
  apiUrl: string;
  slug: string;
  hash: string;
  /**
   * Returned only once from project create — not stored on the project list.
   * After the user closes this dialog, we do not show it here again on this device (see localStorage key above).
   */
  gatewayJwtSecretOneTime?: string | null;
};

function CopyField({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function copyValue(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied */
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-zinc-500">{label}</p>
      <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copyValue()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Copy Service URL"
          title="Copy Service URL"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-400" aria-hidden />
          ) : (
            <Clipboard className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}

function GatewayEnvOneTimeBlock({
  envLine,
}: {
  envLine: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function copyLine(): Promise<void> {
    try {
      await navigator.clipboard.writeText(envLine);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied */
    }
  }

  return (
    <div className="rounded-md border border-amber-800/80 bg-amber-950/40 p-3.5">
      <p className="text-sm font-semibold text-amber-100">
        Copy your gateway secret now
      </p>
      <p className="mt-2 text-xs leading-relaxed text-amber-200/90">
        Add this line to your gateway or app{" "}
        <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[11px]">
          .env
        </code>
        . For security,{" "}
        <strong className="font-medium text-amber-50">
          we will not show this value again in this dialog
        </strong>{" "}
        on this browser after you close it. If you lose it, use{" "}
        <strong className="font-medium text-amber-50">Repair</strong> on the
        project or run{" "}
        <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[11px]">
          flux project credentials
        </code>{" "}
        from the CLI.
      </p>
      <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-900/60 bg-black/50 p-2.5">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-snug text-amber-50">
          {envLine}
        </code>
        <button
          type="button"
          onClick={() => void copyLine()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-amber-300/90 transition-colors hover:bg-amber-950/80 hover:text-amber-50"
          aria-label="Copy gateway environment line"
          title="Copy full line"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-400" aria-hidden />
          ) : (
            <Clipboard className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}

export function V2GettingStartedModal({
  open,
  onClose,
  apiUrl,
  slug,
  hash,
  gatewayJwtSecretOneTime,
}: V2GettingStartedModalProps): React.ReactElement | null {
  const [tokenInput, setTokenInput] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dismissedPriorOnDevice, setDismissedPriorOnDevice] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status: number;
    message: string;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return;
    try {
      setDismissedPriorOnDevice(
        localStorage.getItem(gatewayJwtDismissStorageKey(slug, hash)) === "1",
      );
    } catch {
      setDismissedPriorOnDevice(false);
    }
  }, [open, slug, hash]);

  useEffect(() => {
    if (!open) return;
    const hadOneTimeSecret = Boolean(gatewayJwtSecretOneTime?.trim());
    return () => {
      if (hadOneTimeSecret && slug && hash) {
        try {
          localStorage.setItem(gatewayJwtDismissStorageKey(slug, hash), "1");
        } catch {
          /* private mode / quota */
        }
      }
    };
  }, [open, slug, hash, gatewayJwtSecretOneTime]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      // Defensive unlock in case route transition bypasses the open-state cleanup timing.
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setTokenInput("");
    setTestBusy(false);
    setTestResult(null);
  }, [open, apiUrl]);

  const browserExample = useMemo(
    () =>
      `const token = await window.Clerk?.session?.getToken({ template: "flux" });

const res = await fetch(
  "${apiUrl}/hops?select=*&limit=10",
  {
    headers: {
      Authorization: \`Bearer \${token}\`,
    },
  }
);

const data = await res.json();`,
    [apiUrl],
  );

  const serverExample = useMemo(
    () =>
      `const res = await fetch(
  \`\${process.env.FLUX_URL}/hops?select=*&limit=10\`,
  {
    headers: {
      Authorization: \`Bearer \${token}\`,
    },
    cache: "no-store",
  }
);`,
    [],
  );

  const curlExample = useMemo(
    () =>
      `curl "${apiUrl}/hops?select=*" \\
  -H "Authorization: Bearer <TOKEN>"`,
    [apiUrl],
  );

  async function runTestRequest(): Promise<void> {
    setTestBusy(true);
    setTestResult(null);
    try {
      const inputToken = tokenInput.trim();
      let token = inputToken;
      if (!token) {
        const maybeClerk = (
          window as {
            Clerk?: {
              session?: {
                getToken?: (opts: { template: string }) => Promise<string | null>;
              };
            };
          }
        ).Clerk;
        token =
          (await maybeClerk?.session?.getToken?.({ template: "flux" })) ?? "";
      }
      if (!token) {
        throw new Error(
          "No token found. Paste a token or sign in with Clerk and retry.",
        );
      }

      const res = await fetch(`${apiUrl}/hops?select=*&limit=1`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const bodyText = await res.text();
      const clipped =
        bodyText.length > 220 ? `${bodyText.slice(0, 220)}...` : bodyText;
      setTestResult({
        ok: res.ok,
        status: res.status,
        message: clipped || (res.ok ? "Request succeeded." : "Request failed."),
      });
    } catch (err) {
      setTestResult({
        ok: false,
        status: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestBusy(false);
    }
  }

  const trimmedOneTime = gatewayJwtSecretOneTime?.trim() ?? "";
  const gatewayEnvLine = `${GATEWAY_ENV_KEY}=${trimmedOneTime}`;
  const showGatewaySecretOnce =
    Boolean(trimmedOneTime) && !dismissedPriorOnDevice;
  const showDismissedGatewayNotice =
    Boolean(trimmedOneTime) && dismissedPriorOnDevice;
  const showRecoveryHint = dismissedPriorOnDevice && !trimmedOneTime;

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-start justify-center overflow-y-auto bg-black/75 p-4 pt-3 backdrop-blur-sm sm:pt-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-md border border-zinc-800 bg-zinc-950 p-4 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2-getting-started-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>

        <div className="pr-8">
          <h2
            id="v2-getting-started-title"
            className="text-xl font-semibold text-zinc-100"
          >
            Connect to your project
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Use your Service URL with your app&apos;s auth token to query your
            database.
          </p>
        </div>

        {showGatewaySecretOnce ? (
          <div className="mt-5">
            <GatewayEnvOneTimeBlock envLine={gatewayEnvLine} />
          </div>
        ) : null}
        {showDismissedGatewayNotice ? (
          <div
            className="mt-5 rounded-md border border-zinc-700 bg-zinc-900/50 px-3 py-2.5 text-xs leading-relaxed text-zinc-400"
            role="status"
          >
            This browser already acknowledged the gateway signing secret for
            this project in this dialog, so it is not shown again here. Retrieve
            it anytime with{" "}
            <strong className="font-medium text-zinc-300">Repair</strong> on the
            project card or{" "}
            <code className="rounded bg-black/50 px-1 py-0.5 font-mono text-[11px] text-zinc-200">
              flux project credentials
            </code>{" "}
            in the CLI.
          </div>
        ) : null}
        {showRecoveryHint ? (
          <p
            className="mt-5 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs leading-relaxed text-zinc-400"
            role="note"
          >
            To retrieve your{" "}
            <code className="font-mono text-[11px] text-zinc-300">
              FLUX_GATEWAY_JWT_SECRET
            </code>{" "}
            signing key, use{" "}
            <strong className="font-medium text-zinc-300">Repair</strong> on the
            project or{" "}
            <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[11px] text-zinc-200">
              flux project credentials
            </code>{" "}
            — it is not kept in this dialog after the first copy flow.
          </p>
        ) : null}

        <div className="mt-5">
          <CopyField label="Service URL (your API endpoint)" value={apiUrl} />
        </div>

        <div className="mt-5 space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">
              Browser Example (Clerk)
            </h3>
            <CodeBlock code={browserExample} label="ts" language="ts" />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">
              Server Example (Next.js)
            </h3>
            <CodeBlock code={serverExample} label="ts" language="ts" />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">
              cURL Test
            </h3>
            <CodeBlock code={curlExample} label="bash" language="bash" />
          </section>
        </div>

        <div
          className="mt-5 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-100"
          role="note"
        >
          This project uses pooled infrastructure. There are no static API
          keys - Flux uses your app&apos;s auth tokens.
        </div>

        <section className="mt-5 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-200">Test Request</h3>
            <button
              type="button"
              onClick={() => void runTestRequest()}
              disabled={testBusy}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {testBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {testBusy ? "Testing..." : "Test Request"}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Uses <code className="font-mono">?limit=1</code>. Leave token blank to
            auto-use Clerk session token when available.
          </p>
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Optional: paste Bearer token"
            className="mt-2 w-full rounded-md border border-zinc-700 bg-black px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-shadow focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/30"
          />
          {testResult ? (
            <p
              className={`mt-2 rounded-md border px-2.5 py-2 font-mono text-xs ${
                testResult.ok
                  ? "border-emerald-900/70 bg-emerald-950/30 text-emerald-200"
                  : "border-red-900/70 bg-red-950/30 text-red-200"
              }`}
              role="status"
            >
              [{testResult.ok ? "OK" : "ERROR"}]{" "}
              {testResult.status > 0 ? `HTTP ${String(testResult.status)} - ` : ""}
              {testResult.message}
            </p>
          ) : null}
        </section>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
          >
            Close
          </button>
          <Link
            href={`/docs/getting-started/first-request?slug=${encodeURIComponent(slug)}&hash=${encodeURIComponent(hash)}`}
            onClick={() => {
              handleClose();
              document.body.style.overflow = "";
            }}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-600 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-white"
          >
            View Pooled Stack Guide
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
