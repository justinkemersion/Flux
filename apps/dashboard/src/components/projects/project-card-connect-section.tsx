"use client";

import { Eye, Loader2 } from "lucide-react";
import { CopyableConnectField } from "@/src/components/projects/copyable-connect-field";
import type { ProjectRow } from "@/src/components/projects/project-types";

type Props = {
  project: ProjectRow;
  isV2Shared: boolean;
  credentialsLoaded: boolean;
  canRevealCredentials: boolean;
  connectSecretEmptyHint: string | undefined;
  revealBusy: boolean;
  revealError: string | null;
  keysRotationNotice: boolean;
  onRevealKeys: () => void;
};

export function ProjectCardConnectSection({
  project: p,
  isV2Shared,
  credentialsLoaded,
  canRevealCredentials,
  connectSecretEmptyHint,
  revealBusy,
  revealError,
  keysRotationNotice,
  onRevealKeys,
}: Props): React.ReactElement {
  return (
    <section className="mt-6" aria-labelledby={`connect-heading-${p.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`connect-heading-${p.id}`}
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            How to connect
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            {isV2Shared
              ? "Pooled project: use the service URL with short-lived JWTs from the Flux gateway. Per-tenant Docker Postgres strings and static anon/service keys are not exposed from this UI."
              : "Everything you need to reach Postgres and the REST API. Load secrets once; they are not stored in the project list. Use the eye icon to reveal the Postgres URI or service role key before copying."}
          </p>
        </div>
        {!credentialsLoaded && canRevealCredentials ? (
          <button
            type="button"
            onClick={onRevealKeys}
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
      {keysRotationNotice ? (
        <p
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          role="status"
        >
          JWT secret was updated. Previously copied anon/service keys are now stale. Click{" "}
          <strong className="font-medium">Load connection secrets</strong> to refresh them
          before using signed-out requests.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-6">
        {isV2Shared ? (
          <CopyableConnectField
            label="API URL"
            value={p.apiUrl || null}
            isSecret={false}
            visuallyTruncate
            prominent
          />
        ) : (
          <>
            <CopyableConnectField
              label="Postgres connection string"
              value={credentialsLoaded ? (p.postgresConnectionString ?? null) : null}
              isSecret
              prominent
              emptyHint={connectSecretEmptyHint}
            />
            <CopyableConnectField
              label="Anon key"
              value={credentialsLoaded ? (p.anonKey ?? null) : null}
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
              value={credentialsLoaded ? (p.serviceRoleKey ?? null) : null}
              isSecret
              prominent
              emptyHint={connectSecretEmptyHint}
            />
          </>
        )}
      </div>

      {!credentialsLoaded && !canRevealCredentials ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {isV2Shared ? (
            <>
              Use the service URL above with gateway-issued JWTs. If the API stays unhealthy,
              try <strong className="font-medium">Repair</strong> or{" "}
              <strong className="font-medium">Delete</strong>.
            </>
          ) : (
            <>
              Secrets stay hidden until the stack is healthy. Use{" "}
              <strong className="font-medium">Repair</strong> if Docker is out of sync, or{" "}
              <strong className="font-medium">Delete</strong> to remove this project.
            </>
          )}
        </p>
      ) : null}
      {credentialsLoaded && !isV2Shared ? (
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Update the JWT signing secret or CORS from project settings when your auth setup
          changes.
        </p>
      ) : null}
    </section>
  );
}
