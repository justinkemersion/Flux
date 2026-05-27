import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { loadConfig, resolveFluxApiToken, saveConfig } from "../config";
import { cliDimHint } from "../utils/cli-audience";

export async function runFluxLogin(options: { refresh?: boolean }): Promise<void> {
  let key: string | undefined;

  if (options.refresh) {
    key = resolveFluxApiToken();
    if (!key) {
      throw new Error(
        "No saved token. Run `flux login` and paste an API key from Dashboard → Settings → API keys, or set FLUX_API_TOKEN.",
      );
    }
    const masked =
      key.length > 12 ? `${key.slice(0, 12)}…${key.slice(-4)}` : "(token)";
    console.log(chalk.dim(`Refreshing profile using saved token ${masked}`));
  } else {
    const existing = loadConfig()?.token;
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const prompt =
      existing && !process.env.FLUX_API_TOKEN
        ? "API key (Enter to keep saved key, or paste a new one): "
        : "API key (Dashboard → Settings → API keys): ";
    const entered = (await rl.question(prompt)).trim();
    await rl.close();
    key = entered || existing || process.env.FLUX_API_TOKEN?.trim();
    if (!key) {
      throw new Error(
        "No API key entered. Create one in Dashboard → Settings → API keys.",
      );
    }
  }

  const client = getApiClient();
  const { user, plan, defaultMode, cliRole } = await client.verifyToken(key);
  saveConfig({
    token: key,
    profile: { plan, defaultMode, user, cliRole },
  });
  console.log(
    options.refresh
      ? `Flux profile refreshed for ${user}.`
      : `Flux authenticated as ${user}.`,
  );
  cliDimHint(
    `  Plan: ${plan} (typical default mode: ${defaultMode}). CLI role: ${cliRole}.`,
    { plan, defaultMode, user, cliRole },
  );
  if (cliRole === "operator") {
    console.log(chalk.dim("  Operator mode: non-essential CLI hints are hidden."));
  }
}
