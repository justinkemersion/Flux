# Flux v1 dedicated SQL workflows (Sarah guide)

Purpose: run quick SQL updates on a v1 dedicated Flux project from terminal, with both repeatable and ad-hoc methods.

This guide is intentionally copy/paste friendly and beginner-safe.

---

## 0) Prerequisites

- Flux CLI installed (`flux --version`)
- Logged in (`flux login`)
- A v1 dedicated project slug + hash
- `psql` installed locally (for direct SQL method)

---

## 1) Confirm your project and hash

List your projects:

```bash
flux list
```

Pick your target project slug + hash.

Example used below:

- slug: `bloom-atelier`
- hash: `61d9dff`

---

## 2) Method A (recommended): SQL file + `flux push`

Use this for anything you may want to keep, review, or replay later.

Create a file:

```bash
cat > quick-change.sql <<'EOF'
create table if not exists notes (
  id bigserial primary key,
  body text not null,
  created_at timestamptz not null default now()
);

insert into notes (body) values ('hello from Sarah');
EOF
```

Apply it:

```bash
flux push ./quick-change.sql -p bloom-atelier --hash 61d9dff
```

If `flux.json` already has slug/hash, the command can be shorter:

```bash
flux push ./quick-change.sql
```

---

## 3) Method B: one-line SQL with `psql -c` (no `.sql` file)

Use this for truly quick, low-risk updates.

### Step 1: get your dedicated Postgres connection string

```bash
flux project credentials -p bloom-atelier --hash 61d9dff
```

Copy the printed `postgresConnectionString` value.

### Step 2: run one SQL statement

```bash
psql "<postgresConnectionString>" -c "select now();"
```

Quick update example:

```bash
psql "<postgresConnectionString>" -c "update notes set body = 'updated' where id = 1;"
```

---

## 4) Method C: multi-line ad-hoc SQL via heredoc + `psql`

This gives quick multi-statement updates without saving a file.

```bash
psql "<postgresConnectionString>" <<'SQL'
begin;
insert into notes (body) values ('heredoc insert');
update notes set body = 'edited by heredoc' where id = 1;
commit;
SQL
```

Tip: include `begin/commit` for grouped changes.

---

## 5) Safety before risky changes

Before destructive SQL (`drop`, irreversible `alter`, broad delete):

```bash
flux backup create -p bloom-atelier --hash 61d9dff
flux backup verify -p bloom-atelier --hash 61d9dff --latest
```

Backup trust model:

- Backups are only trustworthy after restore verification.
- Artifact validation checks that the backup file exists and is non-empty.
- Restore verification runs `pg_restore` in a disposable database.

Reference: detailed trust-model notes in [`plans/backups/backups-plan.md`](../../plans/backups/backups-plan.md).

---

## 6) Troubleshooting

### "Unauthorized" from Flux CLI

Run:

```bash
flux login
```

### "Project not found" with slug/hash

Double-check with:

```bash
flux list
```

### `psql` connection refused / timeout

- confirm project is running:

```bash
flux start bloom-atelier --hash 61d9dff
```

- retry with a fresh credentials value from `flux project credentials`

### Permission errors in SQL

Use the dedicated project credentials for v1 dedicated and verify you are connected to the expected project/hash.

---

## 7) Which method should Sarah use?

- Default: **Method A** (`flux push`) for anything meaningful.
- Use **Method B/C** for small, immediate edits.
- If you might need to explain or replay the change later, use a file and commit it.
