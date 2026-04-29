import chalk from "chalk";
import { visibleLength } from "./ansi";

const KEY = "FLUX_GATEWAY_JWT_SECRET";

/** Split a plain ASCII string into segments of at most `max` characters. */
function chunkPlain(s: string, max: number): string[] {
  if (max <= 0) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += max) {
    out.push(s.slice(i, i + max));
  }
  return out;
}

/**
 * Boxed "copy to .env" block for `FLUX_GATEWAY_JWT_SECRET`.
 * Uses {@link visibleLength} so chalk styling does not break the right border.
 */
export function printGatewayJwtEnvCopyBlock(
  jwtSecret: string,
  options?: { innerWidth?: number },
): void {
  const inner = options?.innerWidth ?? 56;
  const hr = chalk.dim("─".repeat(inner));
  const leftBar = chalk.dim("  │ ");
  const rightBar = chalk.dim("│");
  const assignmentPlain = `${KEY}=${jwtSecret}`;
  const chunks = chunkPlain(assignmentPlain, inner);
  const prefix = `${KEY}=`;

  console.log(chalk.dim("  ┌") + hr + chalk.dim("┐"));
  const title = chalk.bold.cyan("COPY TO .env — Gateway tenant JWT");
  console.log(
    `${leftBar}${title}${" ".repeat(Math.max(0, inner - visibleLength(title)))}${rightBar}`,
  );
  console.log(chalk.dim("  ├") + hr + chalk.dim("┤"));

  for (const chunk of chunks) {
    let styled: string;
    if (chunk.startsWith(prefix)) {
      const rest = chunk.slice(prefix.length);
      styled =
        chalk.cyan(prefix) + (rest.length > 0 ? chalk.green(rest) : "");
    } else {
      styled = chalk.green(chunk);
    }
    const pad = " ".repeat(Math.max(0, inner - visibleLength(styled)));
    console.log(`${leftBar}${styled}${pad}${rightBar}`);
  }

  console.log(chalk.dim("  └") + hr + chalk.dim("┘"));
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
