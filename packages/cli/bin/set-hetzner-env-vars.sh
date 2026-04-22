ssh-add ~/.ssh/id_ed25519_emersion
# Point your local Docker CLI to the Hetzner VPS                                                                  
export DOCKER_HOST="ssh://root@178.104.205.138"

# Point Flux to the base domain
export FLUX_DOMAIN="vsl-base.com"

# Tell Flux who you are (the user context for the DB lookup)
export FLUX_OWNER_KEY="user_3CYBgW7bmTFed4QYv0wCgy40XVy"

