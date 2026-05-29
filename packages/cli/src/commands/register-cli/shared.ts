import { readFluxJson, type FluxJson } from "../../flux-config";
import { printErrorAndExit } from "../../output/cli-errors";

export const HASH_FLAG_DESC =
  '7-hex project hash (overrides "hash" in flux.json)';

export async function readFluxJsonCwd(): Promise<FluxJson | null> {
  return readFluxJson(process.cwd());
}

/** Wrap a Commander action with try/catch → printErrorAndExit. */
export function cliAction<T extends unknown[]>(
  fn: (...args: T) => void | Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      printErrorAndExit(err);
    }
  };
}

/** Like cliAction but loads flux.json from CWD first. */
export function cliActionWithFlux<T extends unknown[]>(
  fn: (flux: FluxJson | null, ...args: T) => void | Promise<void>,
): (...args: T) => Promise<void> {
  return cliAction(async (...args: T) => {
    const flux = await readFluxJsonCwd();
    await fn(flux, ...args);
  });
}

export function collectOriginOption(
  value: string,
  prev: string[] = [],
): string[] {
  const trimmed = value.trim();
  if (trimmed.length > 0) prev.push(trimmed);
  return prev;
}
