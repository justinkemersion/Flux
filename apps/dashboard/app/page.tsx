import { FluxLanding } from "@/src/components/flux-landing";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flux — Deterministic Orchestration",
  description:
    "Isolated PostgreSQL and PostgREST per project. Projects resting on Flux — high-performance, industrial orchestration at flux.vsl-base.com.",
};

export default function Home() {
  return <FluxLanding />;
}
