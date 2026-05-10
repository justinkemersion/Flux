import chalk from "chalk";

export function isFluxDebug(): boolean {
  return (
    process.env.FLUX_DEBUG != null &&
    process.env.FLUX_DEBUG !== "" &&
    process.env.FLUX_DEBUG !== "0"
  );
}

export function formatCliError(err: unknown): string {
  if (err instanceof Error) {
    if (isFluxDebug()) return err.stack ?? err.message;
    return err.message;
  }
  if (err !== null && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function printErrorAndExit(err: unknown): void {
  console.error(chalk.red("Error:"), formatCliError(err));
  process.exit(1);
}
