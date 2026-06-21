<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## `@flux/core` in client components

**Never** import the root `@flux/core` barrel from `"use client"` files or from lib modules pulled into client bundles (e.g. `src/lib/project-db-access-copy.ts`).

Use **browser-safe subpaths only** — see [docs/ARCHITECTURE-CONTRACT.md](../../docs/ARCHITECTURE-CONTRACT.md) (Dashboard client bundle section). CI enforces this via `pnpm check:architecture`.

When adding private DB / CLI copy for the UI, put shared labels in `@flux/core/database-access-gui` (or another allowlisted subpath), not in `@flux/core` root.
