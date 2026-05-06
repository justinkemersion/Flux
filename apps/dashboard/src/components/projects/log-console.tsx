"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LogLineFormattedView } from "@/src/lib/log-line-html";

type Props = {
  slug: string;
  hash: string;
  maxLines?: number;
  /** When set, skip Docker log streaming (v2 has no per-tenant containers). */
  mode?: "v1_dedicated" | "v2_shared";
};
type TapState = "idle" | "open" | "err";

type StreamProps = {
  slug: string;
  hash: string;
  service: "api" | "db";
  maxLines: number;
  onData: () => void;
  onErrorState: () => void;
  onSseError: (msg: string | null) => void;
};

/**
 * Isolated open stream: remount via parent key; no setState in effect start.
 */
function LogEventStream({
  slug,
  hash,
  service,
  maxLines,
  onData,
  onErrorState,
  onSseError,
}: StreamProps) {
  const [logErr, setLogErr] = useState<string | null>(null);
  const [lines, setLines] = useState<{ key: string; line: string }[]>([]);
  const scrollerRef = useRef<HTMLPreElement>(null);
  const followTail = useRef(true);
  const esRef = useRef<EventSource | null>(null);

  const pushLine = useCallback(
    (line: string) => {
      onData();
      setLines((prev) => {
        const next = [
          ...prev,
          {
            key: `${String(Date.now())}-${String(Math.random())}`,
            line,
          },
        ];
        if (next.length > maxLines) {
          return next.slice(-maxLines);
        }
        return next;
      });
    },
    [maxLines, onData],
  );

  useEffect(() => {
    const pre = scrollerRef.current;
    if (pre && followTail.current) {
      pre.scrollTop = pre.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    const u = new URL(
      `/api/projects/${encodeURIComponent(slug)}/logs/stream`,
      window.location.origin,
    );
    u.searchParams.set("hash", hash);
    u.searchParams.set("service", service);

    const es = new EventSource(u.toString());
    esRef.current = es;

    es.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return;
      let parsed: { line?: string; error?: string };
      try {
        parsed = JSON.parse(ev.data) as { line?: string; error?: string };
      } catch {
        return;
      }
      if (typeof parsed.error === "string") {
        setLogErr(parsed.error);
        onErrorState();
        return;
      }
      if (typeof parsed.line === "string") {
        setLogErr(null);
        pushLine(parsed.line);
      }
    });
    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CLOSED) {
        onSseError("log stream connection closed");
        onErrorState();
      }
    });

    return () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [slug, hash, service, onErrorState, onData, pushLine, onSseError]);

  return (
    <>
      {logErr ? (
        <p className="mb-1 font-mono text-xs text-red-400" role="alert">
          {logErr}
        </p>
      ) : null}
      <pre
        ref={scrollerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          followTail.current = nearBottom;
        }}
        className="h-40 max-h-52 overflow-y-auto border border-zinc-800 bg-black p-2 font-mono text-[10px] leading-relaxed text-zinc-300"
        tabIndex={0}
      >
        {lines.map((row) => (
          <div key={row.key} className="whitespace-pre-wrap break-words">
            <LogLineFormattedView line={row.line} service={service} />
          </div>
        ))}
      </pre>
    </>
  );
}

const V2_LOGS_EXPLAINER =
  "Pooled v2_shared projects do not have dedicated Docker PostgREST or Postgres containers, so this console cannot stream per-tenant logs. On the host, inspect logs for flux-postgrest-pool, flux-node-gateway, or the shared cluster.";

function LogConsoleV2PooledInfo(): ReactNode {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Logs
      </div>
      <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        {V2_LOGS_EXPLAINER}
      </p>
    </div>
  );
}

type DockerProps = { slug: string; hash: string; maxLines: number };

/**
 * v1: EventSource to dashboard SSE (session cookie), CLI-shaped lines.
 */
function LogConsoleDocker({ slug, hash, maxLines }: DockerProps) {
  const [service, setService] = useState<"api" | "db">("api");
  const [tap, setTap] = useState<TapState>("idle");
  const [sseMsg, setSseMsg] = useState<string | null>(null);

  const onData = useCallback(() => {
    setSseMsg(null);
    setTap("open");
  }, []);
  const onErrorState = useCallback(() => {
    setTap("err");
  }, []);

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>
          Logs {tap === "open" ? "(live)" : tap === "err" ? "(error)" : ""}
        </span>
        <div className="flex gap-px border border-zinc-800">
          {(["api", "db"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setService(s);
                setTap("idle");
                setSseMsg(null);
              }}
              className={`px-2 py-1 text-[9px] ${
                service === s
                  ? "bg-zinc-800 text-zinc-200"
                  : "bg-zinc-950 text-zinc-500 hover:bg-zinc-900"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {sseMsg ? (
        <p className="mb-1 font-mono text-xs text-amber-500/90" role="status">
          {sseMsg}
        </p>
      ) : null}
      <LogEventStream
        key={`${slug}-${hash}-${service}`}
        slug={slug}
        hash={hash}
        service={service}
        maxLines={maxLines}
        onData={onData}
        onErrorState={onErrorState}
        onSseError={setSseMsg}
      />
    </div>
  );
}

/**
 * Black scroll region: v2 shows static explainer; v1 streams Docker container logs.
 */
export function LogConsole({ slug, hash, maxLines = 500, mode }: Props) {
  if (mode === "v2_shared") {
    return <LogConsoleV2PooledInfo />;
  }
  return <LogConsoleDocker slug={slug} hash={hash} maxLines={maxLines} />;
}
