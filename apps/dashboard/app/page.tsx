import { FluxLanding } from "@/src/components/flux-landing";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flux — PostgreSQL, ready to use",
  description:
    "A clean API over your database. No setup. No abstraction. Start free and upgrade when your app grows.",
};

export default function Home() {
  return <FluxLanding />;
}
