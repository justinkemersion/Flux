# docs/_contract/reader-audiences.md

# Reader audiences for `docs/pages/`

Public docs rendered at **`/docs`** default to one primary reader. Internal Flux engineering details belong elsewhere unless explicitly scoped and labeled.

---

## Primary reader (default)

**App builder** — ships an application on Flux (pooled or dedicated). They own:

- Application repo, env files, CI
- SQL migrations and `flux push` workflow
- JWT claims, RLS policies, `GRANT`s, and Service URL usage in clients

They do **not** own the Flux monorepo, control-plane Docker images, production deploy scripts, or hosted infrastructure packaging.

Author **every** `docs/pages/` page for this reader first: short sentences, product vocabulary (control plane, dashboard, Service URL, engine mode), actionable steps they can perform (CLI flags, dashboard, support).

---

## Secondary readers (explicit only)

### Self-hosted operator

Runs **their own** Flux install (dashboard API, Docker host, env). May need container names, rebuild steps, and host env vars.

**Rule:** Operator-only steps must appear under a clear heading (e.g. **Self-hosted operators**) or live on pages already framed as operations (e.g. [Production hardening](/docs/guides/production-hardening)). Do not bury operator commands in flows that read as “every hosted customer does this.”

### Flux platform engineering

Maintains **this** repository and hosted `flux.vsl-base.com` (or sibling products). Uses runbooks, PRs, image tags, and internal monitoring.

**Rule:** Do not point the primary reader at repo paths (`apps/…`, `packages/…`, `bin/…`), source filenames, or internal function names as if they were homework. If engineering context helps contributors, put it in repo-only docs (`README.md`, `AGENTS.md`, private ops docs)—**not** in default troubleshooting for hosted users.

---

## Hosted vs self-hosted (language)

| Situation | Primary reader sees |
|-----------|----------------------|
| Control-plane bug or missing tool (e.g. `pg_dump` on server) on **hosted** Flux | This is a **platform** requirement. They verify `FLUX_API_BASE` / token, then **contact support** or use your status channel—not “edit our Dockerfile.” |
| Same issue on **self-hosted** | Short operator checklist: install tooling in the **dashboard/control-plane runtime**, rebuild/restart that service. Monorepo paths are optional; prefer product names (“dashboard container”) unless the page is contributor-only. |

Never imply the app builder broke the platform by not installing Alpine packages on their laptop.

---

## Anti-patterns (do not ship in `docs/pages/`)

- Troubleshooting that names **TypeScript symbols** or **internal function names** (readers cannot act on them).
- “Deploy an updated `flux-web` build” **without** saying whether the reader is hosted (wait for vendor) vs self-hosted (their ops).
- Bare **`README.md`** pointers when a **`/docs`** page states the same idea—prefer in-docs links.
- **`apps/`**, **`packages/`**, **`bin/`**, **`Dockerfile`** in default (hosted) user flows—gate behind **Self-hosted** or remove.

---

## Relationship to other contracts

- [`voice.md`](voice.md) — tone and honesty.
- [`information-architecture.md`](information-architecture.md) — where topics live.
- [`page-template.md`](page-template.md) — page shape; “Who is it for?” defaults to the **primary reader** unless the page is operator-only.

When in doubt, read the page aloud as an app builder on hosted Flux: if it sounds like an internal stand-up, rewrite.
