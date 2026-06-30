"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { CopyToClipboardButton } from "@/src/components/ui/copy-to-clipboard-button";

export function CopyableConnectField({
  label,
  value,
  isSecret,
  visuallyTruncate = false,
  prominent = false,
  emptyHint,
}: {
  label: string;
  value: string | null;
  isSecret: boolean;
  /** Single-line ellipsis for long non-secret values (e.g. anon JWT). */
  visuallyTruncate?: boolean;
  /** Larger type and padding for the “How to connect” section. */
  prominent?: boolean;
  /** Shown instead of “Unavailable” when the value is empty (e.g. secrets not loaded yet). */
  emptyHint?: string;
}) {
  const [revealed, setRevealed] = useState(false);

  const raw = value ?? "";
  const unavailable = raw.length === 0;
  const masked = isSecret && !revealed && !unavailable;
  const displayText = unavailable
    ? (emptyHint ?? "Unavailable")
    : masked
      ? "••••••••"
      : raw;
  const showEmptyHint = unavailable && Boolean(emptyHint);

  const labelCls = prominent
    ? "mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
    : "mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400";
  const boxCls = prominent
    ? "px-3 py-3 dark:bg-zinc-900/60"
    : "px-2 py-1.5 dark:bg-zinc-900/50";
  const valueCls = prominent
    ? "text-sm leading-snug"
    : "text-xs leading-relaxed";

  return (
    <div className="min-w-0">
      <p className={labelCls}>{label}</p>
      <div
        className={`flex min-w-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50/90 dark:border-zinc-800 ${boxCls}`}
      >
        <span
          className={`min-w-0 flex-1 ${valueCls} ${
            showEmptyHint
              ? "font-sans italic text-zinc-500 dark:text-zinc-400"
              : `font-mono text-zinc-800 dark:text-zinc-200 ${
                  visuallyTruncate && !masked
                    ? "truncate"
                    : unavailable
                      ? "text-zinc-400 dark:text-zinc-500"
                      : "break-all"
                }`
          }`}
          title={unavailable || masked ? undefined : raw}
        >
          {displayText}
        </span>
        {isSecret && !unavailable ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={revealed ? "Hide value" : "Reveal value"}
            title={revealed ? "Hide" : "Reveal"}
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : null}
        <CopyToClipboardButton
          text={raw}
          disabled={unavailable}
          ariaLabel={`Copy ${label}`}
        />
      </div>
    </div>
  );
}
