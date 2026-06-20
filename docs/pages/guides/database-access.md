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
- Password: use `flux project credentials <project> --hash <hash>` (existing credentials flow).
- Pass 1 ships `flux db tunnel`, `flux db gui-config`, and `flux db access-plan`.

## v2 pooled behavior (Pass 1 preview)

- Tunnel target: shared pool Postgres (internal Docker network only).
- Scope: tenant schema only (`t_<shortId>_api`).
- Pass 1 returns a preview access plan; scoped temporary credentials arrive in Pass 2.
- Pooled admin credentials are never exposed for GUI access.

## Beekeeper / DBeaver / TablePlus setup

1. Run `flux db tunnel <project> --hash <hash>` (v1 dedicated in Pass 1).
2. Create a Postgres connection to `127.0.0.1` and the local port printed by the CLI (default `15432`).
3. SSL: disabled over the tunnel.
4. Keep the tunnel terminal open while the GUI session is active.

## psql setup

Pass 2 will add `flux db shell`. Until then, open a v1 tunnel and run `psql` manually against localhost.

## pg_dump examples

Pass 2 will add `flux db dump`. v2 pooled dumps are always schema-scoped and never whole-pool dumps.

## Restore warnings

- v1 dedicated restore requires explicit destructive confirmation and backup trust gates.
- v2 pooled restore into production schemas is restricted; restore into a scratch project first.

## Read-only vs read-write access

Schema grants and RLS are the security boundary. `search_path` is a GUI convenience only.

## Temporary credentials

Pass 2 adds temporary project-scoped roles for v2 pooled projects. Passwords are shown once and expire automatically.

## Troubleshooting

- **SSH auth failed:** verify `FLUX_DB_TUNNEL_SSH_HOST`, your SSH key, and `DOCKER_HOST=ssh://…` if used.
- **Local port in use:** omit `--strict-port` to auto-increment from `15432`, or pass `--local-port`.
- **Docker permission denied / container not found:** the CLI resolver tries `getent hosts` then `docker inspect` on the SSH host.
- **v2 pooled tunnel unavailable in Pass 1:** use `flux db access-plan` for the preview plan; temporary credentials are coming next.
- **GUI connects but shows no tables (v2):** ensure search path includes your tenant schema once Pass 2 credentials ship.
