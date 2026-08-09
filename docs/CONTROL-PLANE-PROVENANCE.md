# Control-plane build provenance and pooled migration readiness

The pooled (`v2_shared`) push SQL adapter runs in the **deployed control plane**, not in the
CLI. `flux push` sends SQL unmodified via `client.pushSql`; the dashboard calls
`adaptPooledPushSql` and rewrites `authenticated` and `ON SCHEMA public` for the tenant. So a
verified CLI artifact ([CLI build provenance](./CLI-BUILD-PROVENANCE.md)) proves nothing about
which code will rewrite your migration.

**Production migration readiness requires both a verified CLI artifact and a verified
compatible deployed control plane.**

## The artifact chain

```
host git checkout ($REPO_ROOT)
  └─ bin/deploy-web.sh reads HEAD + dirty state          ← only place that can see .git
      └─ docker compose build (context = repo root, .dockerignore excludes .git)
          ├─ ARG FLUX_BUILD_SOURCE_SHA / _DIRTY / _TIMESTAMP  → builder ENV
          ├─ pnpm --filter @flux/cli build      → dist/index.cjs (served by /api/install/cli)
          └─ pnpm --filter dashboard build      → .next/standalone (provenance inlined here)
              └─ image flux-web:latest, also tagged flux-web:<sha>
                  └─ container flux-web (compose, Traefik-routed)
                      └─ node apps/dashboard/server.js
                          └─ GET /api/health  → the commit actually serving
```

### Where provenance used to be lost

Every one of these was a real gap before this contract existed:

1. **`git pull` was optional** (`FLUX_DEPLOY_GIT_SYNC=1`), so the deployed commit was whatever
   happened to be on the host's disk, and the deploy never recorded it.
2. **`.dockerignore` excludes `.git`**, so the build could not discover its own commit even in
   principle. Nothing passed it in.
3. **No build args** conveyed source identity into the image.
4. **`image: flux-web:latest`** — a mutable tag. `docker inspect` could offer only an image ID
   and a creation time, and creation time is not provenance.
5. **`FLUX_DEPLOY_RESTART_ONLY=1`** runs `compose up --no-build`, bringing up whatever
   `flux-web:latest` currently points at, fully decoupled from the checkout.
6. **No dirty-tree check** — a working tree with uncommitted changes deployed silently.
7. **Verification was liveness-only**: `State.Running == true` plus an HTTP status code from a
   Traefik probe. Nothing asserted *which code* answered, and `docker image prune -f` then
   destroyed the previous image, so even the rollback target lost its identity.
8. **No candidate/canary for web.** The gateway deploy proves a new image serves before cutover;
   the web deploy recreated the container in place, so a bad build took the route down first and
   was diagnosed afterwards.

## Embedded metadata

`bin/deploy-web.sh` resolves provenance from the checkout **before** the build, passes it as
Docker build args, and the Dockerfile promotes them to builder `ENV`. Next inlines them at
compile time via `env` in `next.config.ts`, so the emitted server bundle contains the commit as
a literal.

| Field | Source | Forgeable at runtime? |
| --- | --- | --- |
| `version` | `apps/dashboard/package.json` | no (compiled in) |
| `sourceSha` | host `git rev-parse HEAD` → build arg → webpack `DefinePlugin` | no |
| `dirtyAtBuild` | host `git status --porcelain --untracked-files=no` | no |
| `buildTimestamp` | deploy script clock | no |
| `gatewayContractVersion` | `@flux/core/contract-versions` | no (imported source) |
| `pooledPushAdapterContract` | `@flux/core/contract-versions` | no (imported source) |

Because the expressions are substituted during `next build`, the container's environment cannot
impersonate them. `apps/dashboard/scripts/verify-build-provenance.mjs` proves this on the real
artifact and runs in CI: it asserts the commit is a literal in `.next/server`, boots the built
standalone server with a **conflicting** `FLUX_BUILD_SOURCE_SHA`, and fails if the served value
changes.

Unset build args mean empty, which classifies as `unknown` and fails closed. Nothing is ever
inferred from image creation time or file mtimes.

## Runtime endpoint

`GET /api/health` — liveness plus build identity.

```json
{
  "ok": true,
  "status": "ok",
  "provenanceStatus": "established",
  "provenanceDetail": "Control plane runs 16a8224f07b9, adapter contract 2.0.0.",
  "provenance": {
    "version": "0.1.0",
    "sourceSha": "16a8224f07b91854c4d8b9b3b30801c7e97af7b1",
    "dirtyAtBuild": false,
    "buildTimestamp": "2026-08-09T11:00:00Z",
    "gatewayContractVersion": "1.0.0",
    "pooledPushAdapterContract": "2.0.0"
  }
}
```

**Unauthenticated by design, and deliberately narrow.** The deploy guard must verify a
candidate container that is not yet routed and has no credentials, and `flux` must verify before
committing to a mutation. Every field is a build identifier from a public repository. The
response carries no secrets, credentials, tenant identifiers, environment values or filesystem
paths, and a test asserts the exact allowed key set plus the absence of forbidden substrings.

It is bypassed in `proxy.ts` ahead of the session and rate-limit layers: a health endpoint that
breaks when auth configuration is incomplete cannot be used to diagnose that condition.

`/api/health` returns **200 whenever the process serves**, even when provenance is `unknown`.
Provenance problems are reported in the body, not as a failed health check — the container is
working, it just cannot be identified, and answering 503 would tell orchestrators to restart a
healthy process. Callers that require identity read the body.

There is no `/api/health/deep` on the dashboard. Provenance is build identity, not dependency
readiness, so it belongs on liveness. Deep readiness for the data plane remains the gateway's
`/health/deep`.

## Deploy guard

`bin/deploy-web.sh` now:

1. resolves `EXPECTED_SHA` from the checkout **before** building (so it cannot be derived from
   the artifact it validates);
2. **refuses a dirty tree** — `FLUX_DEPLOY_ALLOW_DIRTY=1` is a documented emergency exception and
   the resulting build is refused by `flux` for pooled migrations anyway;
3. refuses a non-git checkout outright;
4. builds the image with provenance build args;
5. starts an **unrouted candidate** on `127.0.0.1:3099` (no Traefik labels, no docker.sock),
   waits for `/api/health`, and **aborts the deploy if the candidate's `sourceSha` is not
   `EXPECTED_SHA`** — the live route is never touched on failure;
6. tags the image `flux-web:<sha>` for identification and rollback;
7. cuts over;
8. re-reads `/api/health` from inside the **live** container and fails the deploy if the serving
   commit is not `EXPECTED_SHA`, so a lingering old container cannot pass as success.

An unknown SHA is never accepted silently. `FLUX_WEB_SKIP_CANARY=1` exists and says plainly that
it deploys an unverified control plane.

## Migration preflight and the compatibility rule

```bash
flux control-plane verify           # exit 0 = ready, 1 = not ready
flux control-plane verify --json
```

It reports the CLI artifact verdict, the local checkout HEAD, the contracts this checkout
expects, and the deployed control plane's provenance, then a single READY / NOT READY verdict.

### The rule

A pooled production migration may proceed only when **all** hold:

1. the CLI artifact is not `stale` or `unknown` (see [CLI build provenance](./CLI-BUILD-PROVENANCE.md));
2. the control plane returns provenance and it is `established` — reachable, with a source
   commit, not built dirty, and advertising an adapter contract;
3. `pooledPushAdapterContract` equals what this checkout expects;
4. `gatewayContractVersion` equals what this checkout expects.

**Exact SHA equality is reported but not required by default.** This is a deliberate decision.
Requiring it would block every application migration whenever any unrelated Flux commit landed,
forcing a control-plane deploy in the middle of security work — manufacturing deploy pressure is
the opposite of safety. What actually matters is the behavior of the code that rewrites tenant
SQL, and that is pinned: `FLUX_POOLED_PUSH_ADAPTER_CONTRACT` is tied to a SHA-256 digest of
`pooled-push-sql-adapt.ts` by `contract-versions.test.ts`, so the adapter cannot change without
either bumping the contract or failing CI. Contract agreement is therefore a stronger statement
about the relevant code than commit equality, and it is checkable.

Operators who want the strict coupling anyway:

```bash
flux control-plane verify --require-sha-match
```

`flux push` applies the check automatically for `v2_shared` projects in apply mode and fails
closed with the reasons. `FLUX_ALLOW_UNVERIFIED_CONTROL_PLANE=1` overrides with a loud warning
and is a documented exception only.

## Deployment plan (run when separately authorized)

Deploying is **not** part of establishing this contract. When authorized:

```bash
# On the control-plane host, from the repo root:
git pull --ff-only
git status --porcelain --untracked-files=no    # must be empty
bash bin/deploy-web.sh                         # refuses dirty; verifies candidate + live SHA
```

Then, from the operator checkout:

```bash
flux version --json                 # CLI artifact: expect verified
flux control-plane verify           # expect READY
curl -s https://flux.vsl-base.com/api/health | jq .provenance
```

Gateway and data plane are unchanged by this work, but confirm they are still healthy:

```bash
curl -s https://<gateway-host>/health
curl -s https://<gateway-host>/health/deep
```

Finally, prove the adapter end to end on a **disposable tenant** before touching application
data: create a throwaway project, push a migration that exercises `TO authenticated` in
executable SQL *and* the same token inside a comment and a dollar-quoted body, confirm only the
executable occurrences were rewritten, then deprovision. Only then is migration infrastructure
READY.

## Related documentation

- [CLI build provenance](./CLI-BUILD-PROVENANCE.md)
- [Operations runbook](./OPERATIONS.md)
- [Bridge JWTs and pooled push adaptation](./pages/architecture/bridge-jwts.md)
