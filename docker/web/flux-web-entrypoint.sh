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
exec su-exec nextjs "$@"
