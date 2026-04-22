import { Fragment, type ReactNode } from "react";

/**
 * Mirrors `formatLogLineForTerminal` in packages/cli: bold [api|db], dim ISO
 * timestamp, neutral body.
 */
export function LogLineFormattedView({
  line,
  service,
}: {
  line: string;
  service: "api" | "db";
}): ReactNode {
  const label = service === "api" ? "api" : "db";
  const m = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+([\s\S]*)$/,
  );
  if (m) {
    return (
      <Fragment>
        <span className="font-semibold text-zinc-200">[{label}]</span>{" "}
        <span className="text-zinc-600">{m[1]!}</span>{" "}
        <span className="text-zinc-300">{m[2]!}</span>
      </Fragment>
    );
  }
  return (
    <Fragment>
      <span className="font-semibold text-zinc-200">[{label}]</span>{" "}
      <span className="text-zinc-300">{line}</span>
    </Fragment>
  );
}
