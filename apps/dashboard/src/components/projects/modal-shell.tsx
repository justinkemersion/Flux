"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

type ModalTier = "default" | "destructive";

const backdropClass: Record<ModalTier, string> = {
  default:
    "fixed inset-0 z-[240] flex items-start justify-center overflow-y-auto bg-zinc-950/70 p-4 pt-3 backdrop-blur-md sm:pt-4",
  destructive:
    "fixed inset-0 z-[250] flex items-start justify-center overflow-y-auto bg-zinc-950/75 p-4 pt-3 backdrop-blur-md sm:pt-4",
};

const panelMaxWidthClass = {
  md: "max-w-md",
  "2xl": "max-w-2xl",
} as const;

type Props = {
  open: boolean;
  /** Gate portal render until client mount (SSR-safe modals). */
  mounted?: boolean;
  onClose: () => void;
  labelledBy: string;
  tier?: ModalTier;
  maxWidth?: keyof typeof panelMaxWidthClass;
  panelClassName?: string;
  /** Red border accent (factory reset). */
  accentBorder?: boolean;
  closeDisabled?: boolean;
  lockBodyScroll?: boolean;
  children: ReactNode;
};

const panelBaseClass =
  "relative w-full rounded-md border bg-white p-6 shadow-2xl dark:bg-zinc-900";

const panelBorderClass = {
  default: "border-zinc-200/70 dark:border-zinc-800/80",
  accent: "border-red-300 dark:border-red-900",
} as const;

/**
 * Shared portal shell for project detail modals (settings, database tools, destructive flows).
 */
export function ProjectModalShell({
  open,
  mounted = true,
  onClose,
  labelledBy,
  tier = "default",
  maxWidth = "md",
  panelClassName = "",
  accentBorder = false,
  closeDisabled = false,
  lockBodyScroll = false,
  children,
}: Props): React.ReactElement | null {
  useEffect(() => {
    if (!open || !lockBodyScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, lockBodyScroll]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={backdropClass[tier]}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`${panelBaseClass} ${panelBorderClass[accentBorder ? "accent" : "default"]} ${panelMaxWidthClass[maxWidth]} ${panelClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
