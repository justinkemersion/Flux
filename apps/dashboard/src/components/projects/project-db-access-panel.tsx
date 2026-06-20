"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { CliSnippetRow } from "@/src/components/projects/project-card-cli-snippets";
import {
  buildGuiConfigFields,
  dbDumpCommand,
  dbGuiConfigCommand,
  dbShellCommand,
  dbTunnelCommand,
  privateDbAccessIntro,
} from "@/src/lib/project-db-access-copy";

type Props = {
  slug: string;
  hash: string;
  mode: "v1_dedicated" | "v2_shared";
  tenantSchema?: string;
};

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
      <dt className="text-xs font-medium text-zinc-600 dark:text-zinc-500">{label}</dt>
      <dd className="font-mono text-xs text-zinc-700 dark:text-zinc-300">{value}</dd>
    </div>
  );
}

export function ProjectDbAccessPanel({ slug, hash, mode, tenantSchema }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const gui = buildGuiConfigFields({ slug, hash, mode, tenantSchema });
  const v1 = mode === "v1_dedicated";

  return (
    <section className="mt-6" aria-labelledby="private-db-access-heading">
      <h3
        id="private-db-access-heading"
        className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
      >
        Private Database Access
      </h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {privateDbAccessIntro(mode)}
      </p>

      <div className="mt-4 space-y-4">
        <div className="rounded-md border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            CLI commands
          </h4>
          <div className="mt-3 flex flex-col gap-3">
            <CliSnippetRow line={dbTunnelCommand(slug, hash)} />
            <CliSnippetRow line={dbShellCommand(slug, hash)} />
            <CliSnippetRow line={dbDumpCommand(slug, hash, mode)} />
            <CliSnippetRow line={dbGuiConfigCommand(slug, hash)} />
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            GUI config
          </h4>
          <dl className="mt-3 space-y-2">
            <CopyField label="Connection Name" value={gui.connectionName} />
            <CopyField label="Type" value={gui.type} />
            <CopyField label="Host" value={gui.host} />
            <CopyField label="Port" value={String(gui.port)} />
            <CopyField label="User" value={gui.user} />
            <CopyField label="Password" value={gui.passwordBehavior} />
            <CopyField label="Database" value={gui.database} />
            <CopyField label="SSL" value={gui.sslMode} />
            {gui.searchPath ? (
              <CopyField label="Search path" value={gui.searchPath} />
            ) : null}
          </dl>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
            {gui.tunnelNote}
          </p>
        </div>

        {!v1 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            Pooled restore through the CLI is restricted. Use temporary
            project-scoped credentials from `flux db tunnel`; restore into
            production pooled schemas is not supported.
          </p>
        ) : null}

        <section className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/40">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Advanced details
            </span>
            <ChevronDown
              className={`h-4 w-4 text-zinc-500 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {advancedOpen ? (
            <div className="border-t border-zinc-200 px-4 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              {v1 ? (
                <ul className="space-y-1">
                  <li>Mode: dedicated</li>
                  <li>Internal DB host/container: flux-{hash}-{slug}-db</li>
                  <li>Internal port: 5432</li>
                  <li>Restore support: `flux db restore` with backup gates</li>
                </ul>
              ) : (
                <ul className="space-y-1">
                  <li>Mode: pooled</li>
                  <li>Project schema: {tenantSchema ?? "t_<shortId>_api"}</li>
                  <li>Access model: temporary project-scoped role</li>
                  <li>Default access: read-only</li>
                  <li>Dump scope: tenant schema only</li>
                  <li>Restore support: restricted</li>
                </ul>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
