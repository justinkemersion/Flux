import type { Metadata } from "next";
import { MarketingLanding } from "./marketing-landing";

export const metadata: Metadata = {
  title: "Flux — Apps first. Infrastructure underneath.",
  description:
    "Flux powers a growing set of useful tools: ledgers, inbox maintenance, home catalogs, brewing records, language systems, and other durable software.",
};

export default function Home() {
  return <MarketingLanding />;
}
