---
title: Private Database Access
description: Connect SQL tools to Flux projects through CLI-managed SSH tunnels without exposing Postgres publicly.
---

# Private Database Access

Postgres stays private on the Flux platform. Project owners open a temporary local SSH tunnel with the Flux CLI, then connect Beekeeper Studio, DBeaver, TablePlus, DataGrip, `psql`, or `pg_dump` to `127.0.0.1`.

## Why Flux uses private tunnels

- Postgres is not bound to the public internet.
- Access is auditable and mode-aware.
- v1 dedicated and v2 pooled projects use different credential models.

## v1 dedicated behavior

- Tunnel target: the project's dedicated Postgres container.
- GUI user: `postgres`.
- Password: use `flux db password <project> --hash <hash>` or `flux project credentials … --field postgres.password` (v1 dedicated only).
- CLI: `flux db tunnel`, `flux db gui-config`, `flux db access-plan`, and `flux db restore` (with backup gates).

## v2 pooled behavior

- Tunnel target: shared pool Postgres (internal Docker network only).
- Scope: tenant schema only (`t_<shortId>_api`).
- Credentials: temporary project-scoped roles created by the control plane when you run `flux db tunnel` or `flux db gui-config --create-temp-credentials`.
- Default access: read-only. Read/write requires platform policy (`FLUX_DB_ACCESS_ALLOW_READWRITE=1`).
- Pooled admin credentials are never exposed for GUI access.

## Beekeeper / DBeaver / TablePlus setup

1. Run `flux db tunnel <project> --hash <hash>`.
2. For **v1 dedicated**, reveal the Postgres password with `flux db password <project> --hash <hash>` and paste it into your SQL viewer.
3. For **v2 pooled**, copy the username and one-time password printed in the GUI config block when the tunnel creates temporary credentials.
4. Create a Postgres connection to `127.0.0.1` and the local port printed by the CLI (default `15432`).
5. SSL: disabled over the tunnel.
6. For pooled projects, set search path to your tenant schema (the CLI prints it).
7. Keep the tunnel terminal open while the GUI session is active.

## Getting the password for your SQL viewer

`flux db tunnel` does not print long-lived passwords. Use an explicit reveal command instead:

```bash
flux db password yeastcoast --hash ffca33f
```

That prints only the Postgres password on stdout — suitable for pasting into Beekeeper, DBeaver, or TablePlus.

Alternative field selector on the existing credentials command:

```bash
flux project credentials yeastcoast --hash ffca33f --field postgres.password
```

Structured v1 output (user, password, host, port, and connection URL) is available without `--field`:

```bash
flux project credentials yeastcoast --hash ffca33f
```

**v1 dedicated** uses the project Postgres password from the control plane.

**v2 shared/pooled** never exposes pooled admin credentials. Run `flux db tunnel` to create a temporary scoped readonly role; the one-time password appears in the tunnel GUI config when credentials are created.

## psql setup

Run `flux db shell <project> --hash <hash>`. The CLI opens the tunnel, creates temporary pooled credentials when needed, and launches `psql`. Pass `--command 'SELECT 1'` for a non-interactive smoke query.

## pg_dump examples

```bash
flux db dump myproject --hash abc1234 --output myproject.dump
```

For temporary readonly credentials, full data dumps may fail on tables protected by row-level security. Use `--schema-only` for DDL-only exports, or `flux backup create` for a verified full tenant export.

v2 pooled dumps are always schema-scoped (`--schema=t_<shortId>_api --no-owner --no-acl`) and never whole-pool dumps.

## Restore warnings

- v1 dedicated restore: `flux db restore --input backup.dump --yes-i-know-this-can-overwrite-data` requires a restore-verified backup unless `--skip-backup-check` is explicitly passed.
- v2 pooled restore into production schemas is refused. Restore into a scratch or dedicated project instead.

## Read-only vs read-write access

Schema grants and RLS are the security boundary. `search_path` is a GUI convenience only. PostgreSQL may expose some catalog metadata to connected roles.

Pass `--readwrite` only when the platform enables it; default is `--readonly`.

## Temporary credentials

v2 pooled projects receive short-lived login roles (default TTL: 1 hour read-only, 30 minutes read/write; max 8 hours). Passwords are shown once, stored only in PostgreSQL until expiry, and audited without logging the secret.

## Troubleshooting

- **SSH auth failed:** verify `FLUX_DB_TUNNEL_SSH_HOST`, your SSH key, and `DOCKER_HOST=ssh://…` if used.
- **Local port in use:** omit `--strict-port` to auto-increment from `15432`, or pass `--local-port`.
- **Docker permission denied / container not found:** the CLI resolver tries `getent hosts` then `docker inspect` on the SSH host.
- **Read/write denied on pooled project:** the platform may disable read/write db access; use read-only or ask an operator about `FLUX_DB_ACCESS_ALLOW_READWRITE`.
- **GUI connects but shows no tables (v2):** ensure search path includes your tenant schema and that you are using the temporary role from `flux db tunnel`, not pooled admin credentials.
