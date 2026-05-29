"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { CopyableConnectField } from "@/src/components/projects/copyable-connect-field";
import type { ProjectRow } from "@/src/components/projects/project-types";

type Props = {
  open: boolean;
  mounted: boolean;
  project: ProjectRow;
  isV2Shared: boolean;
  jwtSecretInput: string;
  onJwtSecretInputChange: (value: string) => void;
  lastSavedJwtSecret: string | null;
  onClearLastSavedJwtSecret: () => void;
  settingsSaving: boolean;
  settingsError: string | null;
  settingsSuccess: boolean;
  destructiveBlocked: boolean;
  destructiveBlockedTitle: string;
  onOpenFactoryReset: () => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
};

export function ProjectCardSettingsModal(props: Props): React.ReactElement | null {
  const {
    open,
    mounted,
    project: p,
    isV2Shared,
    jwtSecretInput,
    onJwtSecretInputChange,
    lastSavedJwtSecret,
    onClearLastSavedJwtSecret,
    settingsSaving,
    settingsError,
    settingsSuccess,
    destructiveBlocked,
    destructiveBlockedTitle,
    onOpenFactoryReset,
    onClose,
    onSubmit,
  } = props;

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[240] flex items-start justify-center overflow-y-auto bg-zinc-950/70 p-4 pt-3 backdrop-blur-md sm:pt-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-md border border-zinc-200/70 bg-white p-6 shadow-2xl dark:border-zinc-800/80 dark:bg-zinc-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`settings-title-${p.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={settingsSaving}
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>

        <div className="pr-10">
          <h2
            id={`settings-title-${p.id}`}
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Project settings
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Use the same signing secret as your auth provider (e.g. Clerk JWT template or
            NextAuth) so PostgREST can verify user tokens. After you save, use{" "}
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              Load connection secrets
            </strong>{" "}
            on the project card to refresh anon and service-role JWTs.
          </p>

          <form onSubmit={onSubmit} className="mt-6">
            {lastSavedJwtSecret ? (
              <div className="mb-6 space-y-2">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Signing key below is only kept until you close this dialog; the server
                  never sends it back.
                </p>
                <CopyableConnectField
                  key={lastSavedJwtSecret}
                  label="Signing key you saved"
                  value={lastSavedJwtSecret}
                  isSecret
                />
                <button
                  type="button"
                  onClick={onClearLastSavedJwtSecret}
                  className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Replace secret
                </button>
              </div>
            ) : null}
            <label
              htmlFor={`jwt-secret-${p.id}`}
              className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
            >
              {lastSavedJwtSecret
                ? "Update JWT secret (optional)"
                : "JWT secret / webhook secret"}
            </label>
            <input
              id={`jwt-secret-${p.id}`}
              type="password"
              value={jwtSecretInput}
              onChange={(e) => onJwtSecretInputChange(e.target.value)}
              autoComplete="off"
              placeholder="Paste signing key"
              disabled={settingsSaving}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 font-mono text-sm outline-none transition-shadow focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
            />

            {settingsError ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{settingsError}</p>
            ) : null}
            {settingsSuccess ? (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                Saved. PostgREST restarted with the new secret. Existing anon/service keys are
                now stale; reload connection secrets on the project card.
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={settingsSaving}
                className="rounded-md px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={settingsSaving}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {settingsSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {settingsSaving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </form>
          {!isV2Shared ? (
            <div className="mt-6 border-t border-zinc-200/70 pt-4 dark:border-zinc-800/80">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Destructive operation</p>
              <button
                type="button"
                onClick={onOpenFactoryReset}
                disabled={destructiveBlocked}
                title={
                  destructiveBlocked ? destructiveBlockedTitle : "Factory reset project"
                }
                className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent dark:text-red-400 dark:hover:bg-red-950/40 dark:disabled:hover:bg-transparent"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Factory reset project
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
