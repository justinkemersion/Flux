import { FluxLanding } from "@/src/components/flux-landing";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flux — Deterministic Orchestration",
  description:
    "Flux infrastructure: isolated PostgreSQL and PostgREST, deterministic orchestration. flux.vsl-base.com",
};

export default function Home() {
  return <FluxLanding />;
}
