import type { Metadata } from "next";
import { MarketingLanding } from "./marketing-landing";

export const metadata: Metadata = {
  title: "Flux — PostgreSQL, ready to use",
  description:
    "SQL migrations, REST APIs, and JWT-aware access without building the infrastructure yourself. Migration-first workflow, shared or dedicated infrastructure.",
};

export default function Home() {
  return <MarketingLanding />;
}
