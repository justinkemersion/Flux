import { isFluxDebug } from "../output/cli-errors";

export function fatalString(err: unknown): string {
  if (err instanceof Error) {
    if (isFluxDebug()) return err.stack ?? err.message;
    return err.message;
  }
  return String(err);
}
