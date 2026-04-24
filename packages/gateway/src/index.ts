/**
 * @flux/gateway — Flux request gateway.
 *
 * Responsibilities (resolve → rate-limit → sign → proxy):
 *   1. Resolve hostname / custom domain → tenant_id
 *      Source of truth: flux-system.domains (Postgres)
 *      Cache:           Redis GET/SET hostname:{host}  (safe to miss; explicit eviction on domain ops)
 *   2. Enforce per-tenant rate limit
 *      Key:    rate:{tenant_id}  (fixed window)
 *      Exceed: HTTP 429; do NOT forward to PostgREST
 *      Redis down: fail-open (allow request; see Redis guardrail below)
 *   3. Mint short-lived runtime JWT
 *      { role: "t_<shortid>_role", tenant_id: "<uuid>", exp: now + 1–5 min }
 *      Gateway is the ONLY issuer of runtime JWTs for tenant API traffic (invariant 3).
 *   4. Proxy to PostgREST (private network only; PostgREST is never public — invariant 4)
 *   5. Best-effort activity INCR
 *      Key:    activity:{tenant_id}  (TTL 60 s)
 *      Redis down: skip silently; never block
 *
 * Non-responsibilities (reject in code review):
 *   - Business logic or tenant lifecycle management
 *   - Writes to flux-system (read-only from gateway)
 *   - Becoming a "mini control plane"
 *
 * Redis guardrail — all Redis calls must be wrapped in try/catch:
 *   try { await redis.incr(key); } catch { /* swallow; log if needed *\/ }
 *   NEVER let a Redis error propagate and abort a proxied request.
 *
 * See docs/flux-v2-architecture.md — §6 (Gateway boundary), §7 (JWT contract),
 *   §11 (Redis + rate limiting), §12 (Custom domains).
 */

export type GatewayPlaceholder = never;
