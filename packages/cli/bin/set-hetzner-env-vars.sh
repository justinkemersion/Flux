ssh-add ~/.ssh/id_ed25519_emersion

# Do NOT set DOCKER_HOST here. Exporting it sends every `docker` / dashboard provision to that host
# and is easy to confuse with local `pnpm dev`. When you intentionally want remote Docker:
#   source ../../../bin/use-remote-docker-hetzner.sh
# To reset this shell back to your laptop:
#   source ../../../bin/use-local-docker.sh

# Point Flux to the base domain
export FLUX_DOMAIN="vsl-base.com"

# Tell Flux who you are (the user context for the DB lookup)
export FLUX_OWNER_KEY="user_3CYBgW7bmTFed4QYv0wCgy40XVy"

