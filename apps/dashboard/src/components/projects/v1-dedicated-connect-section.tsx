"use client";

import { Eye, Loader2 } from "lucide-react";
import { useState } from "react";
import { CopyableConnectField } from "@/src/components/projects/copyable-connect-field";
import type { ProjectRow } from "@/src/components/projects/project-types";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";

type Props = {
  project: ProjectRow;
};

/**
 * v1 dedicated only: load Postgres URI + JWT keys from the credentials API,
 * with per-field reveal (eye) and copy. Used on surfaces that do not render
 * the full ProjectCard (e.g. `/projects/[slug]` mesh readout).
 */
export function V1DedicatedConnectSection({ project: p }: Props) {
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [anonKey, setAnonKey] = useState<string | undefined>(p.anonKey);
  const [serviceRoleKey, setServiceRoleKey] = useState<string | undefined>(
    p.serviceRoleKey,
  );
  const [postgresUri, setPostgresUri] = useState<string | undefined>(
    p.postgresConnectionString ?? undefined,
  );

  const canRevealCredentials =
    p.status === "running" ||
    p.status === "stopped" ||
    p.status === "partial";

  const credentialsLoaded =
    (anonKey?.length ?? 0) > 0 &&
    (serviceRoleKey?.length ?? 0) > 0 &&
    (postgresUri?.length ?? 0) > 0;

  const connectSecretEmptyHint =
    !credentialsLoaded && canRevealCredentials
      ? "Click Load connection secrets to view."
      : undefined;

  async function revealKeys(): Promise<void> {
    if (!canRevealCredentials) return;
    setRevealBusy(true);
    setRevealError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p.slug)}/credentials`);
      const data = (await readResponseJson(res, {
        apiLabel: "project credentials API",
      })) as {
        error?: string;
        anonKey?: string;
        serviceRoleKey?: string;
        postgresConnectionString?: string;
      } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(data, `Reveal failed (${String(res.status)})`),
        );
      }
      if (
        !data ||
        typeof data.anonKey !== "string" ||
        typeof data.serviceRoleKey !== "string" ||
        typeof data.postgresConnectionString !== "string"
      ) {
        throw new Error("Invalid credentials response");
      }
      setAnonKey(data.anonKey);
      setServiceRoleKey(data.serviceRoleKey);
      setPostgresUri(data.postgresConnectionString);
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevealBusy(false);
    }
  }

  return (
    <section
      className="mb-5 rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/80"
      aria-labelledby={`v1-connect-heading-${p.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`v1-connect-heading-${p.id}`}
            className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Postgres and API keys
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Dedicated project: load secrets once, then use the eye icon to reveal
            the Postgres URI or service role key before copying. Same data as{" "}
            <span className="font-mono text-xs">flux project credentials</span>{" "}
            in the CLI.
          </p>
        </div>
        {!credentialsLoaded && canRevealCredentials ? (
          <button
            type="button"
            onClick={() => void revealKeys()}
            disabled={revealBusy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {revealBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
            Load connection secrets
          </button>
        ) : null}
      </div>

      {revealError ? (
        <p
          className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400"
          role="alert"
        >
          {revealError}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        <CopyableConnectField
          label="Postgres connection string"
          value={credentialsLoaded ? (postgresUri ?? null) : null}
          isSecret
          prominent
          emptyHint={connectSecretEmptyHint}
        />
        <CopyableConnectField
          label="Anon key"
          value={credentialsLoaded ? (anonKey ?? null) : null}
          isSecret={false}
          visuallyTruncate
          prominent
          emptyHint={connectSecretEmptyHint}
        />
        <CopyableConnectField
          label="API URL"
          value={p.apiUrl || null}
          isSecret={false}
          visuallyTruncate
          prominent
        />
        <CopyableConnectField
          label="Service role key"
          value={credentialsLoaded ? (serviceRoleKey ?? null) : null}
          isSecret
          prominent
          emptyHint={connectSecretEmptyHint}
        />
      </div>

      {!credentialsLoaded && !canRevealCredentials ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Secrets stay hidden until the stack is in a loadable state (running,
          stopped, or partial). Use Repair from the fleet view if Docker is out of
          sync.
        </p>
      ) : null}
    </section>
  );
}
