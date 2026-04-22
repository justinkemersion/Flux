"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";

const pillars = [
  {
    label: "01_COMPUTE",
    title: "Dedicated logic",
    body: "No shared clusters. Every project gets its own Postgres 16 + PostgREST v12 container pair.",
  },
  {
    label: "02_ROUTING",
    title: "Isolated routing",
    body: "Global hash namespacing and wildcard SSL. No routing collisions, ever.",
  },
  {
    label: "03_LOCAL_WORKFLOW",
    title: "Pure portability",
    body: "Export your schema or connect via CLI. You own your data; we just orchestrate the hardware.",
  },
] as const;

const easeOut = [0.22, 1, 0.36, 1] as const;

const heroContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.09,
      delayChildren: 0.06,
    },
  },
};

const heroItem = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: easeOut },
  },
};

const focusPrimary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const focusSecondary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

export function FluxLanding() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16 sm:px-10 sm:py-24">
        <div className="relative isolate">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-16 -top-8 bottom-0 min-h-[min(100%,32rem)] bg-[radial-gradient(ellipse_100%_80%_at_50%_0%,rgb(99_102_241/0.1)_0%,rgb(0_0_0)_72%)] sm:-inset-x-24 sm:-top-12"
          />

          <motion.section
            aria-labelledby="flux-hero-heading"
            variants={heroContainer}
            initial="hidden"
            animate="show"
            className="relative flex flex-col"
          >
            <motion.h1
              id="flux-hero-heading"
              variants={heroItem}
              className="relative font-sans text-4xl font-extrabold leading-[1.06] tracking-tighter text-white sm:text-5xl sm:leading-[1.05] md:text-6xl"
            >
              Infrastructure for the craft.
            </motion.h1>
            <motion.p
              variants={heroItem}
              className="relative mt-6 max-w-2xl text-lg leading-relaxed text-zinc-500 sm:text-xl"
            >
              High-performance Postgres instances and PostgREST APIs. Isolated by
              design, provisioned in seconds.
            </motion.p>

            <motion.div variants={heroItem} className="relative mt-10 w-full max-w-lg">
              <div
                className="overflow-hidden rounded-md border border-white/5 bg-black"
                role="img"
                aria-label="Example Flux CLI command"
              >
                <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
                  <span
                    className="size-2 rounded-full bg-zinc-600/70"
                    aria-hidden
                  />
                  <span
                    className="size-2 rounded-full bg-zinc-600/70"
                    aria-hidden
                  />
                  <span
                    className="size-2 rounded-full bg-zinc-600/70"
                    aria-hidden
                  />
                </div>
                <div className="px-4 py-3 font-mono text-sm">
                  <span className="text-zinc-500">$ </span>
                  <span className="text-zinc-100">flux</span>
                  <span className="text-zinc-500"> create project-name</span>
                  <motion.span
                    className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-zinc-500 align-middle"
                    animate={{ opacity: [1, 0.2, 1] }}
                    transition={{
                      duration: 1.1,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut",
                    }}
                    aria-hidden
                  />
                </div>
              </div>
            </motion.div>
          </motion.section>
        </div>

        <motion.section
          id="pillars"
          aria-labelledby="bones-heading"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35, ease: easeOut }}
          className="mt-32 sm:mt-40"
        >
          <h2
            id="bones-heading"
            className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500"
          >
            The bones
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {pillars.map((item, i) => (
              <motion.li
                key={item.title}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  delay: 0.45 + i * 0.08,
                  ease: easeOut,
                }}
              >
                <motion.div
                  whileHover={{ y: -3 }}
                  transition={{ type: "spring", stiffness: 420, damping: 28 }}
                  className="group h-full rounded-md border border-zinc-800 px-5 py-5 transition-colors duration-200 hover:border-zinc-700 sm:px-6 sm:py-6"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                    {item.label}
                  </p>
                  <h3 className="mt-2 text-sm font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                    {item.body}
                  </p>
                </motion.div>
              </motion.li>
            ))}
          </ul>
        </motion.section>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.72, ease: easeOut }}
          className="mt-16 flex flex-col items-stretch gap-3 sm:mt-20 sm:flex-row sm:items-center sm:gap-4"
        >
          <LandingCtas />
        </motion.div>

        <p
          className="mt-auto pt-24 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500/35 sm:pt-28"
          aria-label="Platform credits"
        >
          ENGINEERED_ON_DEBIAN // POWERED_BY_DOCKER // ORCHESTRATED_BY_FLUX
        </p>
      </main>
    </div>
  );
}

function LandingCtas() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <p className="text-sm text-zinc-500" aria-live="polite">
        Loading…
      </p>
    );
  }

  const primaryClass = `inline-flex w-full items-center justify-center rounded-md bg-white px-6 py-3.5 text-base font-semibold text-zinc-950 shadow-sm transition-colors hover:bg-zinc-100 sm:w-auto ${focusPrimary}`;

  const secondaryClass = `inline-flex w-full items-center justify-center rounded-md border border-zinc-700 bg-transparent px-6 py-3.5 text-base font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900/50 sm:w-auto ${focusSecondary}`;

  if (status === "unauthenticated") {
    return (
      <>
        <button
          type="button"
          onClick={() => void signIn("github", { callbackUrl: "/projects" })}
          className={primaryClass}
        >
          Get Started
        </button>
        <Link href="#pillars" className={secondaryClass} scroll>
          Read the Docs
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/projects" className={primaryClass}>
        Get Started
      </Link>
      <Link href="#pillars" className={secondaryClass} scroll>
        Read the Docs
      </Link>
    </>
  );
}
