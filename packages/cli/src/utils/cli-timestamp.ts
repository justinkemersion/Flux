/**
 * Canonical CLI timestamp display.
 *
 * Contract: any human-facing CLI output that shows a point in time must use
 * {@link CliTimestamp.formatDisplay} (or {@link formatCliTimestampDisplay}).
 * See docs/ARCHITECTURE-CONTRACT.md § CLI timestamps.
 */

export type CliTimestampInput = string | Date | number | null | undefined;

export type CliTimestampParts = {
  /** Unix epoch milliseconds (portable machine form). */
  unixMs: number;
  /** UTC ISO 8601 with milliseconds when available. */
  iso: string;
  /** Absolute UTC label for humans, e.g. "Jun 20, 2026, 5:18 PM UTC". */
  humanUtc: string;
  /** Relative phrase, e.g. "2 days ago". */
  relative: string;
};

function normalizeIso(unixMs: number): string {
  return new Date(unixMs).toISOString();
}

function humanUtcFromUnixMs(unixMs: number): string {
  return new Date(unixMs).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function relativeFromUnixMs(unixMs: number, nowMs: number): string {
  const diffSec = Math.round((unixMs - nowMs) / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 45) return "just now";

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (absSec < hour) {
    return rtf.format(Math.round(diffSec / minute), "minute");
  }
  if (absSec < day) {
    return rtf.format(Math.round(diffSec / hour), "hour");
  }
  if (absSec < week) {
    return rtf.format(Math.round(diffSec / day), "day");
  }
  if (absSec < month) {
    return rtf.format(Math.round(diffSec / week), "week");
  }
  if (absSec < year) {
    return rtf.format(Math.round(diffSec / month), "month");
  }
  return rtf.format(Math.round(diffSec / year), "year");
}

export class CliTimestamp {
  readonly unixMs: number;
  readonly iso: string;

  private constructor(unixMs: number) {
    this.unixMs = unixMs;
    this.iso = normalizeIso(unixMs);
  }

  static parse(input: CliTimestampInput): CliTimestamp | null {
    if (input == null) return null;

    if (input instanceof Date) {
      const ms = input.getTime();
      return Number.isFinite(ms) ? new CliTimestamp(ms) : null;
    }

    if (typeof input === "number") {
      if (!Number.isFinite(input)) return null;
      const ms = input < 1_000_000_000_000 ? input * 1000 : input;
      return new CliTimestamp(ms);
    }

    const trimmed = input.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      const ms = n < 1_000_000_000_000 ? n * 1000 : n;
      return new CliTimestamp(ms);
    }

    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) return null;
    return new CliTimestamp(ms);
  }

  parts(nowMs = Date.now()): CliTimestampParts {
    return {
      unixMs: this.unixMs,
      iso: this.iso,
      humanUtc: humanUtcFromUnixMs(this.unixMs),
      relative: relativeFromUnixMs(this.unixMs, nowMs),
    };
  }

  /**
   * Canonical human-facing CLI line:
   * `{unixMs} · {iso} · {humanUtc} · {relative}`
   */
  formatDisplay(nowMs = Date.now()): string {
    const p = this.parts(nowMs);
    return `${String(p.unixMs)} · ${p.iso} · ${p.humanUtc} · ${p.relative}`;
  }
}

/** Format a timestamp for CLI output, or em dash when missing/invalid. */
export function formatCliTimestampDisplay(
  input: CliTimestampInput,
  nowMs = Date.now(),
): string {
  const ts = CliTimestamp.parse(input);
  return ts?.formatDisplay(nowMs) ?? "—";
}
