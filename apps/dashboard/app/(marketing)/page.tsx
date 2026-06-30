import type { Metadata } from "next";
import { MarketingLanding } from "./marketing-landing";

export const metadata: Metadata = {
  title: "Flux — Apps first. Infrastructure underneath.",
  description:
    "Provision tenant APIs, push migrations, inspect schemas, verify backups, and give coding agents structured project context through CLI, dashboard, and MCP.",
};

export default function Home() {
  return <MarketingLanding />;
}
