import { SHOWCASE_APPS } from "./showcase-apps";

/** Canonical marketing URLs — single source for hero + demo section CTAs. */
export const FLUX_DEMO_HREF = "/demo" as const;

/**
 * Demo-ready apps shown in the DemoPhilosophy section.
 * Derived from SHOWCASE_APPS so it can't drift from the data.
 * Includes any app with status "Demo Ready" that has a real link.
 */
export const SHOWCASE_DEMO_APPS = SHOWCASE_APPS.filter(
  (app) => app.status === "Demo Ready" && app.href !== "#",
).map((app) => ({ name: app.name, href: app.href }));
