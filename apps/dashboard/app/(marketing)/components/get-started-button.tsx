"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";

const focusPrimary =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const primaryClass = `inline-flex items-center justify-center rounded-md bg-white px-6 py-3 text-base font-medium text-zinc-950 hover:bg-zinc-100 ${focusPrimary}`;

export function GetStartedButton() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <p className="text-sm text-zinc-500" aria-live="polite">
        Loading…
      </p>
    );
  }

  if (status === "unauthenticated") {
    return (
      <button
        type="button"
        onClick={() => void signIn("github", { callbackUrl: "/projects" })}
        className={primaryClass}
      >
        Get started
      </button>
    );
  }

  return (
    <Link href="/projects" className={primaryClass}>
      Open Projects
    </Link>
  );
}
