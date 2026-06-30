/**
 * Load bundled Flux docs for MCP resources (no dashboard_user dashboard dependency).
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOC_SLUGS: Record<string, string> = {
  "guides/mcp": "guides/mcp.md",
  "guides/migrations": "guides/migrations.md",
  "guides/backups": "guides/backups.md",
  "reference/cli": "reference/cli.md",
};

function moduleRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, "..", "bundled-docs"),
    join(here, "..", "..", "..", "docs", "pages"),
    join(process.cwd(), "bundled-docs"),
    join(process.cwd(), "..", "..", "docs", "pages"),
  ];
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/u;

function stripFrontmatter(raw: string): string {
  const match = raw.match(FRONTMATTER_RE);
  return (match?.[1] ?? raw).trimStart();
}

export function isBundledDocSlug(slug: string): boolean {
  return slug in DOC_SLUGS;
}

export async function loadBundledDocMarkdown(slug: string): Promise<string | null> {
  const rel = DOC_SLUGS[slug];
  if (!rel) return null;

  for (const root of moduleRoots()) {
    const filePath = join(root, rel);
    try {
      const raw = await readFile(filePath, "utf8");
      return stripFrontmatter(raw);
    } catch {
      /* try next root */
    }
  }
  return null;
}

export const BUNDLED_DOC_URIS = [
  "flux://docs/guides/mcp",
  "flux://docs/guides/migrations",
  "flux://docs/guides/backups",
  "flux://docs/reference/cli",
] as const;

export function docSlugFromUri(uri: string): string | null {
  const prefix = "flux://docs/";
  if (!uri.startsWith(prefix)) return null;
  const slug = uri.slice(prefix.length);
  return isBundledDocSlug(slug) ? slug : null;
}
