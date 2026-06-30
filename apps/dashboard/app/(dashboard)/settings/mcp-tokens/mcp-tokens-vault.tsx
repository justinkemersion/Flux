"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CopyToClipboardButton } from "@/src/components/ui/copy-to-clipboard-button";
import { MCP_CAPABILITIES } from "@/src/lib/mcp-capabilities";
import type { SafeMcpTokenRecord } from "@/src/lib/mcp-token-sanitize";
import type { McpTokenProjectOption } from "@/src/components/mcp-tokens/mcp-tokens-types";
import {
  MCP_TOKEN_API,
  MCP_TOKEN_FLUX_MCP_ENV_HINT,
  MCP_TOKEN_PLAINTEXT_ONCE_BANNER,
  MCP_TOKENS_PAGE_CLI_NOTE,
  MCP_TOKENS_PAGE_INTRO,
  MCP_TOKENS_PAGE_LEGACY_NOTE,
  MCP_CAPABILITY_PRESET_DEFINITIONS,
  MCP_MIGRATION_APPLY_TOKEN_WARNING,
  MUTATION_CAPABILITY_WARNING,
  activeMcpCapabilityPresetId,
  applyCreateTokenToList,
  applyRevokeToTokenList,
  defaultExpiryDaysForCapabilities,
  expiryIsoFromDays,
  formatMcpTokenTimestamp,
  mcpTokenExpiryOptions,
  parseMcpTokenCreateResponse,
  showsMigrationApplyWarning,
  showsMutationCapableWarning,
  toMcpTokenListRows,
  validateMcpTokenCreateForm,
} from "@/src/components/mcp-tokens/mcp-tokens-utils";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

function statusClass(status: "active" | "expired" | "revoked"): string {
  if (status === "active") return "text-emerald-400";
  if (status === "expired") return "text-amber-400";
  return "text-red-400";
}

function statusLabel(status: "active" | "expired" | "revoked"): string {
  if (status === "active") return "Active";
  if (status === "expired") return "Expired";
  return "Revoked";
}

type Props = {
  initialTokens: SafeMcpTokenRecord[];
  projects: McpTokenProjectOption[];
};

export function McpTokensVault({ initialTokens, projects }: Props) {
  const projectsById = useMemo(() => {
    const out: Record<string, McpTokenProjectOption> = {};
    for (const project of projects) {
      out[project.id] = project;
    }
    return out;
  }, [projects]);

  const [tokens, setTokens] = useState<SafeMcpTokenRecord[]>(initialTokens);
  const [name, setName] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([
    "project:read",
    "schema:read",
  ]);
  const [expiryDays, setExpiryDays] = useState(() =>
    defaultExpiryDaysForCapabilities(["project:read", "schema:read"]),
  );
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const expiryOptions = useMemo(
    () => mcpTokenExpiryOptions(selectedCapabilities),
    [selectedCapabilities],
  );

  const listRows = useMemo(
    () => toMcpTokenListRows(tokens, projectsById),
    [tokens, projectsById],
  );

  const mutationWarning = showsMutationCapableWarning(selectedCapabilities);
  const migrationApplyWarning = showsMigrationApplyWarning(selectedCapabilities);
  const activePresetId = activeMcpCapabilityPresetId(selectedCapabilities);

  const applyPreset = useCallback((capabilities: readonly string[]) => {
    const next = [...capabilities];
    setSelectedCapabilities(next);
    setExpiryDays(defaultExpiryDaysForCapabilities(next));
  }, []);

  const toggleProject = useCallback((id: string) => {
    setSelectedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    );
  }, []);

  const toggleCapability = useCallback((cap: string) => {
    setSelectedCapabilities((prev) => {
      const next = prev.includes(cap) ? prev.filter((value) => value !== cap) : [...prev, cap];
      const nextDefault = defaultExpiryDaysForCapabilities(next);
      setExpiryDays(nextDefault);
      return next;
    });
  }, []);

  const onCreate = useCallback(() => {
    setFormError(null);
    setActionError(null);
    const validation = validateMcpTokenCreateForm({
      projectIds: selectedProjectIds,
      capabilities: selectedCapabilities,
    });
    if (validation) {
      setFormError(validation);
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch(MCP_TOKEN_API.create, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim() || undefined,
              projectIds: selectedProjectIds,
              capabilities: selectedCapabilities,
              expiresAt: expiryIsoFromDays(expiryDays),
            }),
          });
          const json: unknown = await res.json();
          if (!res.ok) {
            const err =
              json && typeof json === "object" && "error" in json && typeof json.error === "string"
                ? json.error
                : "Could not create MCP token.";
            setFormError(err);
            return;
          }
          const parsed = parseMcpTokenCreateResponse(json);
          if (!parsed) {
            setFormError("Unexpected create response.");
            return;
          }
          setPlaintext(parsed.token);
          setTokens((prev) => applyCreateTokenToList(prev, parsed.tokenRecord));
          setName("");
        } catch {
          setFormError("Could not create MCP token.");
        }
      })();
    });
  }, [expiryDays, name, selectedCapabilities, selectedProjectIds]);

  const onRevoke = useCallback((id: string) => {
    setActionError(null);
    if (confirmRevokeId !== id) {
      setConfirmRevokeId(id);
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch(MCP_TOKEN_API.revoke(id), { method: "DELETE" });
          const json: unknown = await res.json();
          if (!res.ok) {
            const err =
              json && typeof json === "object" && "error" in json && typeof json.error === "string"
                ? json.error
                : "Could not revoke MCP token.";
            setActionError(err);
            return;
          }
          const revokedAt = new Date().toISOString();
          setTokens((prev) => applyRevokeToTokenList(prev, id, revokedAt));
          setConfirmRevokeId(null);
        } catch {
          setActionError("Could not revoke MCP token.");
        }
      })();
    });
  }, [confirmRevokeId]);

  return (
    <div className="space-y-8 text-left">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">MCP Tokens</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500">
          {MCP_TOKENS_PAGE_INTRO}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
          {MCP_TOKENS_PAGE_LEGACY_NOTE}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
          {MCP_TOKENS_PAGE_CLI_NOTE}{" "}
          <Link href="/settings/keys" className="text-zinc-400 underline-offset-2 hover:underline">
            API Keys
          </Link>
          .
        </p>
      </div>

      <section
        className="border border-zinc-700 bg-zinc-900/30 p-4 sm:mx-0"
        aria-labelledby="create-mcp-token-heading"
      >
        <h2
          id="create-mcp-token-heading"
          className="mb-3 text-sm font-semibold text-zinc-300"
        >
          Create token
        </h2>
        <div className="flex max-w-2xl flex-col gap-4">
          <label className="flex flex-col gap-1 text-left">
            <span className="text-xs font-medium text-zinc-500">Name (optional)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cursor-agent"
              autoComplete="off"
              className="border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </label>

          <fieldset className="text-left">
            <legend className="mb-2 text-xs font-medium text-zinc-500">Projects</legend>
            {projects.length === 0 ? (
              <p className="text-sm text-zinc-500">No projects yet. Create a project first.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {projects.map((project) => (
                  <li key={project.id}>
                    <label className="flex cursor-pointer items-start gap-2 border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(project.id)}
                        onChange={() => toggleProject(project.id)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">{project.name}</span>
                        <span className="block font-mono text-xs text-zinc-500">{project.slug}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <fieldset className="text-left">
            <legend className="mb-2 text-xs font-medium text-zinc-500">Capability preset</legend>
            <ul className="grid gap-3">
              {MCP_CAPABILITY_PRESET_DEFINITIONS.map((preset) => {
                const active = activePresetId === preset.id;
                const isControlledApplier = preset.id === "controlledMigrationApplier";
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      onClick={() => applyPreset(preset.capabilities)}
                      className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${focus} ${
                        isControlledApplier
                          ? active
                            ? "border-amber-600/80 bg-amber-950/30 ring-1 ring-amber-700/50"
                            : "border-amber-900/70 bg-amber-950/15 hover:border-amber-700/70 hover:bg-amber-950/25"
                          : active
                            ? "border-zinc-500 bg-zinc-900/70 ring-1 ring-zinc-600/50"
                            : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-600 hover:bg-zinc-900/50"
                      }`}
                      aria-pressed={active}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-sm font-semibold ${
                            isControlledApplier ? "text-amber-100" : "text-zinc-100"
                          }`}
                        >
                          {preset.label}
                        </span>
                        {preset.recommendedForCursor ? (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                            Cursor-friendly
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`mt-1 block text-xs leading-relaxed ${
                          isControlledApplier ? "text-amber-200/90" : "text-zinc-500"
                        }`}
                      >
                        {preset.description}
                      </span>
                      {preset.cursorWarning ? (
                        <span className="mt-2 block text-xs font-semibold text-amber-100">
                          {preset.cursorWarning}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          {migrationApplyWarning ? (
            <div
              className="rounded-md border-2 border-amber-600/80 bg-amber-950/40 px-4 py-3 text-left"
              role="alert"
            >
              <p className="text-sm font-semibold text-amber-50">
                WARNING: This MCP token can apply migrations.
              </p>
              <p className="mt-1 text-sm text-amber-100/95">{MCP_MIGRATION_APPLY_TOKEN_WARNING}</p>
              <p className="mt-2 text-xs text-amber-200/80">
                Use a migration planner preset for everyday Cursor sessions.
              </p>
            </div>
          ) : null}

          <fieldset className="text-left">
            <legend className="mb-2 text-xs font-medium text-zinc-500">Capabilities</legend>
            <ul className="grid gap-2 sm:grid-cols-2">
              {MCP_CAPABILITIES.map((cap) => {
                const isApplyCap = cap === "migration:apply";
                return (
                <li key={cap}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm ${
                      isApplyCap
                        ? "border-amber-900/70 bg-amber-950/20 text-amber-100"
                        : "border-zinc-800 bg-zinc-950/60 text-zinc-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCapabilities.includes(cap)}
                      onChange={() => toggleCapability(cap)}
                    />
                    <span className="font-mono text-xs">{cap}</span>
                    {isApplyCap ? (
                      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
                        Can apply schema changes
                      </span>
                    ) : null}
                  </label>
                </li>
              );
              })}
            </ul>
          </fieldset>

          {mutationWarning ? (
            <p className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-left text-xs text-amber-200/90" role="status">
              {MUTATION_CAPABILITY_WARNING}
            </p>
          ) : null}

          <label className="flex flex-col gap-1 text-left">
            <span className="text-xs font-medium text-zinc-500">Expires in</span>
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className="border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              {expiryOptions.map((option) => (
                <option key={option.days} value={option.days}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCreate}
              disabled={pending || projects.length === 0}
              className={`rounded-md border border-zinc-600 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-900 disabled:opacity-50 ${focus}`}
            >
              {pending ? "Working…" : "Create MCP token"}
            </button>
          </div>
        </div>
        {formError ? (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {formError}
          </p>
        ) : null}
        {actionError ? (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {actionError}
          </p>
        ) : null}
      </section>

      {plaintext ? (
        <section
          className="border border-amber-900/60 bg-amber-950/20 p-4"
          aria-live="polite"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-amber-200/90">
              {MCP_TOKEN_PLAINTEXT_ONCE_BANNER}
            </span>
            <CopyToClipboardButton text={plaintext} variant="amber-labeled" className={focus} />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-amber-100/95">
            {plaintext}
          </pre>
          <p className="mt-2 text-xs text-amber-200/70">
            {MCP_TOKEN_FLUX_MCP_ENV_HINT}
          </p>
          <button
            type="button"
            onClick={() => setPlaintext(null)}
            className={`mt-3 rounded-md border border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-400 hover:border-zinc-500 ${focus}`}
          >
            Dismiss
          </button>
        </section>
      ) : null}

      <section className="text-left" aria-labelledby="mcp-token-list-heading">
        <h2
          id="mcp-token-list-heading"
          className="mb-3 text-sm font-semibold text-zinc-300"
        >
          Tokens ({listRows.length})
        </h2>
        {listRows.length === 0 ? (
          <p className="border border-zinc-800 bg-zinc-900/20 px-3 py-4 text-sm text-zinc-500">
            No MCP tokens yet. Create one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {listRows.map((token) => (
              <li
                key={token.id}
                className="border border-zinc-800 bg-zinc-950 p-3 text-sm leading-relaxed"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium text-zinc-300">
                    {token.name ?? "Unnamed token"}
                  </span>
                  <span className={statusClass(token.status)}>{statusLabel(token.status)}</span>
                </div>
                <div className="mt-2 grid gap-1 text-zinc-500 sm:grid-cols-2">
                  <div>
                    <span className="text-zinc-600">preview </span>
                    <span className="font-mono text-zinc-400">{token.keyPreview}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">projects </span>
                    <span>{token.projectLabel}</span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-zinc-600">capabilities </span>
                    <span className="font-mono text-xs text-zinc-400">
                      {token.capabilities.join(", ")}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-600">expires </span>
                    <span>{formatMcpTokenTimestamp(token.expiresAt)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">revoked </span>
                    <span>{formatMcpTokenTimestamp(token.revokedAt)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">last_used </span>
                    <span>{formatMcpTokenTimestamp(token.lastUsedAt)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600">created </span>
                    <span>{formatMcpTokenTimestamp(token.createdAt)}</span>
                  </div>
                </div>
                {token.status === "active" ? (
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 pt-2">
                    <button
                      type="button"
                      onClick={() => onRevoke(token.id)}
                      disabled={pending}
                      className={`rounded-md border border-amber-900/80 px-2 py-1 text-xs font-medium text-amber-500 hover:border-amber-700 disabled:opacity-50 ${focus}`}
                    >
                      {confirmRevokeId === token.id ? "Click to confirm revoke" : "Revoke"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
