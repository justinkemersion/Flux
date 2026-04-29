import { hintLine, printlnCopyEnvSnippetLine } from "./cli-layout";

/**
 * Plain `FLUX_GATEWAY_JWT_SECRET=…` line (no borders/pipes) plus short hints for pooled mode / gateway.
 * Safe to triple-click or block-select without grabbing box drawing characters.
 */
export function printGatewayJwtEnvCopyBlock(jwtSecret: string): void {
  printlnCopyEnvSnippetLine(`FLUX_GATEWAY_JWT_SECRET=${jwtSecret}`);
  console.log();
  hintLine(
    "Same value as control plane projects.jwt_secret — signs HS256 tokens your gateway verifies per Host.",
  );
  hintLine(
    "Distinct from the host pool FLUX_GATEWAY_JWT_SECRET on flux-postgrest-pool (PostgREST pool signing).",
  );
  console.log();
}
