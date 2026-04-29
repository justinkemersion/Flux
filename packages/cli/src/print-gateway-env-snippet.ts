import chalk from "chalk";
import { printlnCopyEnvSnippetLine } from "./cli-layout";

/**
 * Plain `FLUX_GATEWAY_JWT_SECRET=…` line (no borders) plus short hints for pooled mode / gateway.
 */
export function printGatewayJwtEnvCopyBlock(jwtSecret: string): void {
  printlnCopyEnvSnippetLine(`FLUX_GATEWAY_JWT_SECRET=${jwtSecret}`);
  console.log();
  console.log(
    chalk.dim(
      "  Same value as control plane projects.jwt_secret — signs HS256 tokens your gateway verifies per Host.",
    ),
  );
  console.log(
    chalk.dim(
      "  Distinct from the host pool FLUX_GATEWAY_JWT_SECRET on flux-postgrest-pool (PostgREST pool signing).",
    ),
  );
  console.log();
}
