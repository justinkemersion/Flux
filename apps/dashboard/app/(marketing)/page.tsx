import type { Metadata } from "next";
import { MarketingLanding } from "./marketing-landing";

export const metadata: Metadata = {
  title: "Flux — PostgreSQL, ready to use",
  description:
    "A clean API over your database. No setup. Start instantly from the terminal; scale as you grow.",
};

export default function Home() {
  return <MarketingLanding />;
}
