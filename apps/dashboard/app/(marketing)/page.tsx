import type { Metadata } from "next";
import { MarketingLanding } from "./marketing-landing";

export const metadata: Metadata = {
  title: "Flux — Apps first. Infrastructure underneath.",
  description:
    "Flux is a self-hosted application foundry for building and operating small, durable software. Postgres, migrations, backups, APIs, and demo-safe defaults from the same foundation.",
};

export default function Home() {
  return <MarketingLanding />;
}
