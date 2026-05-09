import { readFile } from "node:fs/promises";
import { join } from "node:path";
import "server-only";

export type DocsFrontmatter = {
  title?: string;
  description?: string;
};

export type LoadedDocPage = {
  frontmatter: DocsFrontmatter;
  /** Markdown body after frontmatter */
  body: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u;

/**
 * Slug paths that load from `docs/<file>` instead of `docs/pages/`.
 *
 * Empty by design as of 2026-05-08: every doc page lives under `docs/pages/` with proper
 * frontmatter. See `docs/_review/baselines.md` for the IA-1 reconciliation that retired
 * the previous `architecture/flux-v2-architecture` alias. Re-introduce an entry here only
 * if a doc must live outside `docs/pages/` for a documented architectural reason.
 */
const REPO_DOC_ALIASES: Record<string, string> = {};

const REPO_DOC_ALIAS_METADATA: Record<string, DocsFrontmatter> = {};

function tryRepoRoots(): string[] {
  return [join(process.cwd(), "..", ".."), process.cwd()];
}

function parseFrontmatter(raw: string): LoadedDocPage {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) {
    return { frontmatter: {}, body: raw.trimStart() };
  }
  const yamlBlock = m[1] ?? "";
  const body = m[2] ?? "";
  const frontmatter: DocsFrontmatter = {};
  for (const line of yamlBlock.split(/\r?\n/u)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key === "title") frontmatter.title = val;
    if (key === "description") frontmatter.description = val;
  }
  return { frontmatter, body: body.trimStart() };
}

/** slug [] = index.md at docs/pages root */
export async function loadDocPage(slug: string[]): Promise<LoadedDocPage | null> {
  const slugKey = slug.join("/");
  const aliasRel = REPO_DOC_ALIASES[slugKey];
  if (aliasRel) {
    for (const root of tryRepoRoots()) {
      const filePath = join(root, aliasRel);
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = parseFrontmatter(raw);
        const overlay = REPO_DOC_ALIAS_METADATA[slugKey];
        return {
          frontmatter: { ...parsed.frontmatter, ...overlay },
          body: parsed.body,
        };
      } catch {
        /* try next root */
      }
    }
    return null;
  }

  const rel =
    slug.length === 0 ? "index.md" : `${slug.join("/")}.md`;
  for (const root of tryRepoRoots()) {
    const filePath = join(root, "docs", "pages", rel);
    try {
      const raw = await readFile(filePath, "utf8");
      return parseFrontmatter(raw);
    } catch {
      /* try next root */
    }
  }
  return null;
}
