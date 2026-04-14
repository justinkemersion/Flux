# Flux dashboard

Next.js **App Router** app for the Flux control plane: **GitHub sign-in** (Auth.js / NextAuth v5), **Drizzle ORM** metadata in the **`flux-system`** Postgres project, and UI plus APIs for **tenant projects** (each backed by **`@flux/core`** `ProjectManager`).

Project-wide documentation, stack overview, and a **step-by-step local testing workflow** (CLI + OAuth + Docker) live in the repository **[README.md](../../README.md)**—start there.

## Commands

From the monorepo root:

```bash
pnpm --filter dashboard dev
pnpm --filter dashboard build
pnpm --filter dashboard lint
```

## Configuration

Create **`.env.local`** in this directory. Required values are described in the root README (**Dashboard stack** and **Testing everything**). Never commit secrets.
