import test from "node:test";

const runIntegration = process.env.FLUX_RUN_GAUNTLET_INTEGRATION === "1";

test(
  "gauntlet integration (requires FLUX_RUN_GAUNTLET_INTEGRATION=1)",
  { skip: !runIntegration },
  async () => {
    const { runGauntlet } = await import("./runner");
    const results = await runGauntlet({
      options: {
        mode: "v1_dedicated",
        runs: 1,
        keepFailed: false,
        reportDir: "reports/gauntlet-integration",
        prefix: "gauntlet",
        skipBackup: false,
        json: false,
      },
      argv: ["flux", "gauntlet", "run", "--mode", "v1_dedicated"],
      logger: { log: () => {}, error: () => {} },
    });
    if (results[0]?.status !== "pass") {
      throw new Error(`Gauntlet integration failed: ${results[0]?.failureAnalysis ?? "unknown"}`);
    }
  },
);
