#!/bin/bash
# The "No-Murphy" Deploy Script

export DOCKER_HOST="ssh://root@178.104.205.138"
export FLUX_DOMAIN="vsl-base.com"

echo "🚀 Syncing Flux Infrastructure..."
flux create yeastcoast

echo "📝 Applying Latest Migrations..."
flux push packages/cli/migrations/move_to_api.sql --project yeastcoast
flux push packages/cli/migrations/alter-user-id-to-text.sql --project yeastcoast

echo "🌐 Rebuilding YeastCoast UI..."
ssh root@178.104.205.138 "cd /srv/apps/yeast-coast && docker compose --env-file .env.docker build --no-cache && docker compose --env-file .env.docker up -d"

echo "✅ Deployment Complete: https://yeastcoast.vsl-base.com"
