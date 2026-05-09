---
title: V1 dedicated — quick SQL from your terminal
description: Run ad-hoc or file-based SQL on a v1 dedicated project using flux push, flux project credentials, and local psql.
section: guides
---

# V1 dedicated — quick SQL from your terminal

This guide is for **v1 dedicated** projects only: you have your own Postgres, and the CLI can apply SQL or print a connection string you use with **`psql`** on your machine.

It is copy/paste friendly when you need a small change and do not want to open the dashboard SQL editor.

## What you will learn

- How to confirm slug and hash
- **Method A:** tracked SQL file + **`flux push`** (best default)
- **Method B:** one-line **`psql -c`** with credentials from the CLI
- **Method C:** multi-statement ad-hoc SQL via a heredoc
- When to snapshot the database before risky statements

## Prerequisites

- Flux CLI installed and logged in (`flux login`)
- **`psql`** installed locally (for Methods B and C)
- A **v1 dedicated** project (see [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated))

## 1) Confirm project slug and hash

```bash
flux list
```

Copy the **slug** and **7-character hash** for the row you want. The examples below use placeholder values—substitute **yours**.

```bash
# Example only — use your flux list output
SLUG=percept
HASH=b915ec8
```

## 2) Method A (recommended): SQL file + `flux push`

Use this when the change is worth keeping, reviewing, or replaying (including in Git).

Create a file:

```bash
cat > quick-change.sql <<'EOF'
create table if not exists notes (
  id bigserial primary key,
  body text not null,
  created_at timestamptz not null default now()
);

insert into notes (body) values ('hello from quick SQL');
EOF
```

Apply it:

```bash
flux push ./quick-change.sql --project "$SLUG" --hash "$HASH"
```

If **`flux.json`** in your repo already has **`slug`** and **`hash`**, you can run:

```bash
flux push ./quick-change.sql
```

See [Migrations workflow](/docs/guides/migrations) and [Configuration](/docs/reference/config) for project resolution and CI habits.

## 3) Method B: one-line SQL with `psql -c` (no file)

Use this for small, low-risk statements.

### Get the Postgres connection string

```bash
flux project credentials "$SLUG" --hash "$HASH"
```

Under **Postgres** in the CLI output, copy the full connection URI (starts with `postgresql://`).

### Run one statement

```bash
psql "<pastePostgresUriHere>" -c "select now();"
```

Example update:

```bash
psql "<pastePostgresUriHere>" -c "update notes set body = 'updated' where id = 1;"
```

Treat the URI like a password: do not paste it into public chats or commit it to Git.

## 4) Method C: multi-line ad-hoc SQL (heredoc)

Use this for several statements without creating a `.sql` file.

```bash
psql "<pastePostgresUriHere>" <<'SQL'
begin;
insert into notes (body) values ('heredoc insert');
update notes set body = 'edited in one batch' where id = 1;
commit;
SQL
```

Wrapping related changes in **`begin` / `commit`** keeps them atomic.

## 5) Before destructive changes

Before **`drop`**, irreversible **`alter`**, or broad **`delete`** statements, take a backup and confirm it **restores cleanly**:

```bash
flux backup create --project "$SLUG" --hash "$HASH"
flux backup verify --project "$SLUG" --hash "$HASH" --latest
```

**Trust model (short):**

- Treat a backup as production-trustworthy only after **`flux backup verify`** has succeeded (real restore check).
- Lighter checks may only confirm the backup **file** looks present; they are not a substitute for verify.

The full backup workflow (list, download, restore, the trust labels and tier names) lives in [Backups workflow](/docs/guides/backups); the conceptual model of what a backup contains and guarantees lives in [Backups (concept)](/docs/concepts/backups).

## 6) Troubleshooting

**CLI says unauthorized** — Run **`flux login`** again and confirm **`FLUX_API_BASE`** matches your host (see [Installation](/docs/getting-started/installation)).

**Project not found** — Re-check slug and hash with **`flux list`**. Wrong hash is a common mistake.

**`psql`: connection refused or timeout** — Ensure the stack is running, then fetch a fresh connection URI:

```bash
flux start "$SLUG" --hash "$HASH"
flux project credentials "$SLUG" --hash "$HASH"
```

**Permission errors in SQL** — Confirm you are on **v1 dedicated** and using the credentials from **`flux project credentials`** for that project, not another engine or old connection string.

## Next steps

- [Migrations workflow](/docs/guides/migrations) — canonical migration habits
- [CLI reference](/docs/reference/cli) — all commands and flags
- [Project secrets](/docs/security/project-secrets) — how credentials are exposed and handled
