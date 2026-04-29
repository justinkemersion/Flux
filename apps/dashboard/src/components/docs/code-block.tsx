"use client";

import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

const copyBtnClass =
  "inline-flex items-center gap-1 rounded border border-zinc-700/90 bg-zinc-950/50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-400 transition-[color,background-color,border-color] hover:border-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900";

type CodeBlockProps = {
  code: string;
  /** e.g. bash, env — small label; omit for a minimal block */
  label?: string;
  /** Enables lightweight in-app syntax highlighting */
  language?: "plain" | "ts" | "bash";
  className?: string;
  /** Slightly more padding on the landing / hero */
  size?: "default" | "comfortable";
};

function highlightTsLine(line: string): ReactNode[] {
  const tokenRegex =
    /(".*?"|'.*?'|`.*?`|\b(?:const|let|var|await|async|return|fetch|headers|Authorization|cache|window)\b)/g;
  const chunks = line.split(tokenRegex);
  return chunks.map((chunk, i) => {
    if (!chunk) return <span key={`${chunk}-${String(i)}`} />;
    if (/^(".*?"|'.*?'|`.*?`)$/.test(chunk)) {
      return (
        <span key={`${chunk}-${String(i)}`} className="text-emerald-300">
          {chunk}
        </span>
      );
    }
    if (
      /^(const|let|var|await|async|return|fetch|headers|Authorization|cache|window)$/.test(
        chunk,
      )
    ) {
      return (
        <span key={`${chunk}-${String(i)}`} className="text-sky-300">
          {chunk}
        </span>
      );
    }
    return <span key={`${chunk}-${String(i)}`}>{chunk}</span>;
  });
}

function highlightBashLine(line: string): ReactNode[] {
  const tokenRegex = /(".*?"|'.*?'|\bcurl\b|-H)/g;
  const chunks = line.split(tokenRegex);
  return chunks.map((chunk, i) => {
    if (!chunk) return <span key={`${chunk}-${String(i)}`} />;
    if (/^(".*?"|'.*?')$/.test(chunk)) {
      return (
        <span key={`${chunk}-${String(i)}`} className="text-emerald-300">
          {chunk}
        </span>
      );
    }
    if (chunk === "curl" || chunk === "-H") {
      return (
        <span key={`${chunk}-${String(i)}`} className="text-sky-300">
          {chunk}
        </span>
      );
    }
    return <span key={`${chunk}-${String(i)}`}>{chunk}</span>;
  });
}

function renderHighlightedCode(
  code: string,
  language: "plain" | "ts" | "bash",
): ReactNode {
  const lines = code.split("\n");
  return lines.map((line, idx) => (
    <span key={`${line}-${String(idx)}`} className="block">
      {language === "ts"
        ? highlightTsLine(line)
        : language === "bash"
          ? highlightBashLine(line)
          : line}
    </span>
  ));
}

export function CodeBlock({
  code,
  label,
  language = "plain",
  className = "",
  size = "default",
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const trimmed = code.replace(/\n$/, "");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied */
    }
  }

  const padding = size === "comfortable" ? "p-4 sm:p-5" : "p-4";
  const textSize =
    size === "comfortable"
      ? "text-[12px] sm:text-[13px]"
      : "text-[12px]";

  return (
    <div
      className={`group relative overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900 text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] dark:border-zinc-800/90 ${className}`}
    >
      <div className="flex min-h-9 items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-3 py-1.5">
        {label ? (
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
            {label}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-zinc-600" aria-hidden>
            ·
          </span>
        )}
        <button
          type="button"
          onClick={() => void copy()}
          className={copyBtnClass}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" strokeWidth={2} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={2} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className={`whitespace-pre font-mono leading-relaxed text-zinc-200 ${padding} ${textSize}`}
      >
        {renderHighlightedCode(trimmed, language)}
      </pre>
    </div>
  );
}
