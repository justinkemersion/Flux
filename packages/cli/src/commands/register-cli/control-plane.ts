import { type Command } from "commander";
import {
  formatControlPlaneReport,
  inspectControlPlane,
} from "../../lib/control-plane-preflight";
import { cliAction } from "./shared";

export function registerControlPlaneCommands(program: Command): void {
  const controlPlane = program
    .command("control-plane")
    .description(
      "Inspect the deployed Flux control plane (build provenance, contracts, migration readiness)",
    );

  const verify = controlPlane
    .command("verify")
    .description(
      "Preflight before pooled production migrations: compare CLI artifact, local checkout and deployed control plane",
    )
    .option("--json", "Machine-readable output", false)
    .option(
      "--require-sha-match",
      "Also require the deployed control plane to be the exact local checkout commit",
      false,
    );

  verify.addHelpText(
    "after",
    `
Exit codes:
  0  ready — pooled production migrations may proceed
  1  not ready — see reasons

The pooled push SQL adapter runs in the control plane, so a verified CLI artifact alone does
not establish which code rewrites tenant SQL. Readiness requires both.
`,
  );

  verify.action(
    cliAction(async () => {
      const opts = verify.opts<{ json: boolean; requireShaMatch: boolean }>();
      const preflight = await inspectControlPlane({
        requireShaMatch: opts.requireShaMatch,
      });
      const cliBlocked =
        preflight.cli.verdict.status === "stale" ||
        preflight.cli.verdict.status === "unknown";
      const ready = preflight.readiness.ready && !cliBlocked;

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              ready,
              cli: {
                version: preflight.cli.provenance.version,
                runtime: preflight.cli.provenance.runtime,
                sourceSha: preflight.cli.provenance.sourceSha,
                provenanceStatus: preflight.cli.verdict.status,
              },
              localCheckoutSha: preflight.expected.localSourceSha,
              expected: {
                pooledPushAdapterContract:
                  preflight.expected.pooledPushAdapterContract,
                gatewayContractVersion:
                  preflight.expected.gatewayContractVersion,
                requireShaMatch: preflight.expected.requireShaMatch === true,
              },
              controlPlane: {
                endpoint: preflight.baseUrl,
                provenanceStatus: preflight.readiness.verdict.status,
                provenance: preflight.provenance,
                shaMatchesLocal: preflight.readiness.shaMatchesLocal,
              },
              reasons: preflight.readiness.reasons,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(formatControlPlaneReport(preflight));
      }

      if (!ready) process.exitCode = 1;
    }),
  );
}
