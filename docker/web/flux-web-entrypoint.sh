#!/bin/sh
set -e
# flux-web runs API routes that write v1 backups under FLUX_BACKUPS_* (default /srv/flux/...).
# The process user is `nextjs` (non-root); Docker named volumes are often root-owned until fixed.
LOCAL="${FLUX_BACKUPS_LOCAL_DIR:-/srv/flux/backups}"
OFFSITE="${FLUX_BACKUPS_OFFSITE_DIR:-/srv/flux/backups-offsite}"
mkdir -p "$LOCAL" "$OFFSITE"
if [ -d /srv/flux ]; then
  chown -R nextjs:nodejs /srv/flux
fi
chown -R nextjs:nodejs "$LOCAL" "$OFFSITE" 2>/dev/null || true

# Docker Compose adds the host `docker` group via `group_add`, but `su-exec`/`setuid` helpers
# typically drop supplementary groups, which breaks `/var/run/docker.sock` (root:docker 0660).
# Re-apply uid 1001 + docker GID with setpriv. Compose may pass FLUX_DOCKER_SUPPLEMENTARY_GID from DOCKER_GID.
# Note: Alpine `setpriv` rejects `--clear-groups` together with `--groups` (mutually exclusive).
#
# Supplementary GID for docker.sock (root:docker 0660):
# 1) FLUX_DOCKER_SUPPLEMENTARY_GID when set (Compose forwards DOCKER_GID from `.env` when present).
# 2) Else stat the bind-mounted socket so drift/reinstall on the host does not require `.env` edits.
# 3) Else DOCKER_GID / 996.
NEXTJS_UID=1001
NEXTJS_GID=1001
SUPP_GID=""
if [ -n "${FLUX_DOCKER_SUPPLEMENTARY_GID:-}" ]; then
  SUPP_GID="${FLUX_DOCKER_SUPPLEMENTARY_GID}"
elif [ -e /var/run/docker.sock ]; then
  SUPP_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
fi
if [ -z "$SUPP_GID" ] || [ "$SUPP_GID" = "0" ]; then
  SUPP_GID="${DOCKER_GID:-996}"
fi
exec setpriv \
  --reuid="${NEXTJS_UID}" \
  --regid="${NEXTJS_GID}" \
  --groups="${SUPP_GID}" \
  -- "$@"
