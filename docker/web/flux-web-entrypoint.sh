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
# Re-apply uid 1001 + that GID with setpriv. Compose sets FLUX_DOCKER_SUPPLEMENTARY_GID from DOCKER_GID.
NEXTJS_UID=1001
NEXTJS_GID=1001
SUPP_GID="${FLUX_DOCKER_SUPPLEMENTARY_GID:-${DOCKER_GID:-996}}"
exec setpriv \
  --reuid="${NEXTJS_UID}" \
  --regid="${NEXTJS_GID}" \
  --clear-groups \
  --groups="${SUPP_GID}" \
  -- "$@"
