import { join, resolve, sep } from "node:path";

export function isSafeDocSlugSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("\\")
  );
}

export function resolveDocPageFile(root: string, slug: string[]): string | null {
  if (slug.some((segment) => !isSafeDocSlugSegment(segment))) {
    return null;
  }
  const rel = slug.length === 0 ? "index.md" : `${slug.join("/")}.md`;
  const pagesRoot = resolve(root, "docs", "pages");
  const filePath = resolve(pagesRoot, rel);
  const prefix = pagesRoot.endsWith(sep) ? pagesRoot : `${pagesRoot}${sep}`;
  if (!filePath.startsWith(prefix)) {
    return null;
  }
  return filePath;
}

export function tryDocRepoRoots(cwd: string = process.cwd()): string[] {
  return [join(cwd, "..", ".."), cwd];
}
