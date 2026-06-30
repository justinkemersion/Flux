import { type Command } from "commander";
import { runMcpDoctorAsync } from "../mcp-doctor";
import { cliActionWithFlux } from "./shared";

export function registerMcpCommands(program: Command): void {
  const mcpCmd = program
    .command("mcp")
    .description("MCP server connectivity and contract checks");

  const doctorCmd = mcpCmd
    .command("doctor")
    .description(
      "Validate FLUX_MCP_TOKEN, auth/verify, capabilities, and MCP contract version",
    )
    .option(
      "--base <url>",
      "Control-plane API base (default: FLUX_API_BASE or https://flux.vsl-base.com/api)",
    );

  doctorCmd.action(
    cliActionWithFlux(async () => {
      const opts = doctorCmd.opts<{ base?: string }>();
      const result = await runMcpDoctorAsync({ ...(opts.base ? { baseUrl: opts.base } : {}) });
      for (const line of result.lines) {
        process.stderr.write(`${line}\n`);
      }
      if (!result.ok) {
        process.exitCode = result.exitCode;
      }
    }),
  );
}
