"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";
import {
  docsBody,
  docsInlineCode,
  docsSectionTitle,
  docsSubsectionTitle,
} from "./docs-styles";

function mapLang(lang: string | undefined): "plain" | "ts" | "bash" | "env" {
  if (!lang) return "plain";
  if (lang === "typescript") return "ts";
  if (lang === "sh" || lang === "shell" || lang === "zsh") return "bash";
  if (lang === "env" || lang === "dotenv") return "env";
  if (
    lang === "ts" ||
    lang === "tsx" ||
    lang === "javascript" ||
    lang === "js" ||
    lang === "json"
  ) {
    return "ts";
  }
  if (lang === "bash") return "bash";
  return "plain";
}

export function DocsMarkdown({ markdown }: { markdown: string }) {
  const components: Components = {
    h1: ({ children }) => (
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className={`mt-10 scroll-mt-10 ${docsSectionTitle}`}>{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className={`mt-8 ${docsSubsectionTitle}`}>{children}</h3>
    ),
    p: ({ children }) => <p className={`mt-4 ${docsBody}`}>{children}</p>,
    ul: ({ children }) => (
      <ul className={`mt-4 list-disc space-y-2 pl-5 ${docsBody}`}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className={`mt-4 list-decimal space-y-2 pl-5 ${docsBody}`}>{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-zinc-800 underline-offset-2 transition-colors hover:underline dark:text-zinc-200"
      >
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mt-4 border-l-2 border-zinc-300 pl-4 text-zinc-600 italic dark:border-zinc-600 dark:text-zinc-400">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm text-zinc-700 dark:text-zinc-300">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-zinc-200 dark:border-zinc-700">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-100">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border-t border-zinc-200 px-3 py-2 align-top dark:border-zinc-800">
        {children}
      </td>
    ),
    hr: () => <hr className="my-10 border-zinc-200 dark:border-zinc-800" />,
    strong: ({ children }) => (
      <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{children}</strong>
    ),
    pre: ({ children }) => <>{children}</>,
    code(props) {
      const { children, className } = props;
      const isBlock = Boolean(className?.includes("language-"));
      if (!isBlock) {
        return <code className={docsInlineCode}>{children}</code>;
      }
      const match = /language-([a-zA-Z0-9_-]+)/u.exec(className ?? "");
      const lang = mapLang(match?.[1]);
      const code = String(children).replace(/\n$/u, "");
      return (
        <div className="mt-4">
          <CodeBlock
            code={code}
            language={lang}
            label={match?.[1] ?? "code"}
          />
        </div>
      );
    },
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  );
}
