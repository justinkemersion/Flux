"use client";

import { Check, Clipboard } from "lucide-react";
import { useCallback, useState } from "react";

const iconButtonClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/80 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

const labeledButtonClass =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

const amberLabeledButtonClass =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-amber-800/80 px-2 py-1 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-40";

type CopyToClipboardButtonProps = {
  text: string;
  disabled?: boolean;
  ariaLabel?: string;
  idleLabel?: string;
  copiedLabel?: string;
  variant?: "icon" | "labeled" | "amber-labeled";
  className?: string;
};

export function CopyToClipboardButton({
  text,
  disabled = false,
  ariaLabel = "Copy to clipboard",
  idleLabel = "Copy",
  copiedLabel = "Copied",
  variant = "icon",
  className = "",
}: CopyToClipboardButtonProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (disabled || text.length === 0) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied */
    }
  }, [disabled, text]);

  const icon = copied ? (
    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
  ) : (
    <Clipboard className="h-4 w-4" aria-hidden />
  );

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => void onCopy()}
        disabled={disabled}
        className={`${iconButtonClass} ${className}`.trim()}
        aria-label={copied ? copiedLabel : ariaLabel}
        title={copied ? copiedLabel : idleLabel}
      >
        {icon}
      </button>
    );
  }

  const baseClass = variant === "amber-labeled" ? amberLabeledButtonClass : labeledButtonClass;

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      disabled={disabled}
      className={`${baseClass} ${className}`.trim()}
      aria-label={copied ? copiedLabel : ariaLabel}
    >
      {icon}
      {copied ? copiedLabel : idleLabel}
    </button>
  );
}
