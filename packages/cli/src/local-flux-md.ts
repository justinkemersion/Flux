import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { FLUX_MD_FILENAME } from "@flux/core/flux-md";
import { FLUX_JSON } from "./flux-config";

async function pathReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Nearest directory containing flux.json, or null when not in a Flux app repo. */
export async function findFluxProjectRoot(
  startCwd: string,
): Promise<string | null> {
  let dir = resolve(startCwd);
  for (;;) {
    if (await pathReadable(join(dir, FLUX_JSON))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function readLocalFluxMd(startCwd: string): Promise<{
  root: string;
  content: string;
} | null> {
  const root = await findFluxProjectRoot(startCwd);
  if (!root) return null;
  const filePath = join(root, FLUX_MD_FILENAME);
  if (!(await pathReadable(filePath))) return null;
  const content = await readFile(filePath, "utf8");
  return { root, content };
}
