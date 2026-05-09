# Initial review — 2026-05-08 — full corpus snapshot

**Reviewer:** Claude (composite Sonnet-shape pass: IA + cognitive-load + voice + examples + troubleshooting). Opus truth pass deferred — see [Scope and what was deferred](#scope-and-what-was-deferred).

**Inputs:**
- All files in [`docs/_contract/`](../../_contract/) and [`docs/pages/`](../../pages/) as of 2026-05-08.
- The root [`AGENTS.md`](../../../AGENTS.md) and the project's `.cursorrules` for canonical vocabulary.
- Verification scans (grep) for: cross-link integrity, repo-path leakage, tenant-schema placeholder drift, "Operators"/"Developers" pronoun usage, hype-word vocabulary, `we`/`our`/`us` usage, named personas, undefined "Codex" references, and frontmatter field coverage. Counts and locations are inlined in the relevant pass artifact section.

**Outcome:** **Pass with follow-ups.** The corpus is shippable today. No findings require rolling back content, but five Blockers should be cleared before the next docs-touching release; the Highs and Mediums shape the next two improvement cycles.

**Passes covered:** IA, cognitive load, voice, examples, troubleshooting, plus a meta sweep of [`_contract/`](../../_contract/) repairs.

**Pass deferred:** [technical truth](../technical-truth.md) — requires reading the codebase paths that own each claim (CLI source, gateway parser, schema generator, dashboard env loader). Reserve for a dedicated Opus pass; see [Scope and what was deferred](#scope-and-what-was-deferred).

---

## Executive summary

The bones are strong: the IA contract is unusually thoughtful, voice discipline is already high (zero hype-word hits, zero `we` ambiguity), and several pages — `reference/env-vars.md`, `guides/v2-to-v1-migrate.md`, `concepts/pooled-vs-dedicated.md` — are exemplars of the calm-manual tone the contract asks for.

The reader-facing weaknesses cluster in five places: (1) a broken canonical link to the v2 architecture spec from four pages, (2) three named guide pages that defer to repo files the reader cannot open, (3) an Examples section that under-delivers what its IA slot promises, (4) no canonical home for error symptoms, and (5) a few persistent operator-vs-app-builder slips that contradict the audience contract. Two contract files (`frontmatter.md`, `diagrams.md`) are truncated or malformed and need repair before contributors rely on them.

---

## Findings

Sorted by severity, then by pass-prefix ID. Cross-pass duplicates are listed once with a "also …" note.

| ID | Severity | Page / scope | Finding | Suggested fix |
|----|----------|--------------|---------|---------------|
| IA-1 | Blocker | `pages/architecture/flux-v2.md:12,20`, `pages/security/threat-model.md:8`, `pages/getting-started/auth.md:22`, `pages/security/tenant-isolation.md:30` | Four pages link to `/docs/architecture/flux-v2-architecture`; no such file exists in `pages/`. The 27 KB spec lives at `docs/flux-v2-architecture.md` (top-level), which the dashboard does not render at `/docs`. | Promote `docs/flux-v2-architecture.md` into `pages/architecture/v2-specification.md` with frontmatter. Update the four call sites. |
| IA-2 | Blocker | `pages/guides/authjs.md:30`, `pages/guides/clerk.md:20`, `pages/guides/nextjs.md:22` | Three named guides defer to repo paths the reader cannot open: `docs/guides/flux-nextjs-authjs-rls.md`, `docs/guides/clerk-integration.md`, `docs/guides/flux-nextjs-v2-shared-quickstart.md`. From the reader's POV these are dead pointers. | Pull the substantive content from those repo files into the three `pages/guides/` files. Strike the repo-path lines. |
| EX-1 | Blocker | `pages/examples/bloom-atelier.md` (38 lines) | The IA contract for this slot promises "a complete real-world Flux application … auth, migrations, RLS, API usage, image handling, multi-user behavior." The page actually describes Bloom Atelier as "a canonical sample slug in Flux tests" and shows a hostname pattern. None of the promised behaviors are demonstrated. | Either rebuild as the promised worked app (large piece of writing — confirm scope first), or repurpose the slot as "Worked example: notes app" and ship one real end-to-end story. |
| CONTRACT-1 | Blocker | `_contract/frontmatter.md` | File ends mid-thought at line 35 with only a YAML field shape, no field descriptions or examples. The README lists it as required reading for editors. | Finish the file: required vs optional fields, defaults, slug/url generation rules, and what `section` should be (since 0/37 live pages set it — see CONTRACT-3). |
| CONTRACT-2 | Blocker | `_contract/diagrams.md` | File opens with an outer ```` ```md ```` fence on line 2 and contains an inner ```` ```txt ```` fence (request lifecycle) that is opened but never closed — file ends at "PostgreSQL" with no closing backticks. Documents only 2 of the canonical diagrams; rest of the contract is silent. | Repair fences. Decide scope: text-first ASCII diagrams only, or commit to SVGs (the `docs/assets/diagrams/` folder is empty). Match the spec to the decision. |
| IA-3 | High | corpus-wide; symptoms in `pages/getting-started/first-request.md`, `pages/introduction/mental-model.md`, `pages/architecture/request-flow.md`, `pages/architecture/bridge-jwts.md`, `pages/security/rls-boundaries.md`, `pages/guides/v2-to-v1-migrate.md` | No canonical troubleshooting page exists. The most useful reader content (401 vs 403 vs `42501` vs empty array) is scattered across six pages with no single landing place. The IA tree currently has no slot for it. **Also TROUBLE-1.** | Add `pages/reference/troubleshooting.md` (or `pages/troubleshooting.md`) and add a Troubleshooting section to the IA contract. Have the six pages above link into the canonical entries instead of duplicating cause/resolution. |
| IA-4 | High | `pages/guides/production-hardening.md:26-27` | Body of a default-reader page links to two repo paths: ``` `docs/production-security-audit.md` ``` and ``` `docs/OPERATIONS.md` ```. Forbidden by [`reader-audiences.md`](../../_contract/reader-audiences.md). | Either promote those two files into `pages/` (likely under `pages/security/` and `pages/reference/`) with frontmatter, or remove the references and inline the relevant content. |
| IA-5 | High | `pages/index.md:24-33` | The homepage table sends new readers from "Introduction" to `/docs/introduction/what-is-flux` and from "Concepts" to `/docs/concepts/projects`. It skips over `introduction/mental-model.md`, which the IA contract names as "one of the most important pages in the documentation system." Reader can land on flux-shaped product copy without ever seeing the request-lifecycle diagram. | Make the Introduction row link to `mental-model.md` once `what-is-flux.md` is read, or surface a third pointer ("Start with the mental model"). |
| COG-1 | High | `pages/getting-started/installation.md:18` | "Service URL" is used in the prose ("It is not a replacement for reading how engines and Service URLs work") before its canonical definition in `concepts/service-urls.md`, which is downstream in the IA. The reader at install step has no glossary to anchor the term. | Add a one-line gloss on first use: *"The Service URL is the public hostname your app calls — see [Service URLs]."* |
| COG-2 | High | `pages/getting-started/first-request.md:33-53` | The IA names this page "psychologically important" — it should let the reader succeed end-to-end. The page hands `Authorization: Bearer <token>` and a Clerk-shaped fetch, but never shows how to mint that token from `FLUX_GATEWAY_JWT_SECRET` for a reader who doesn't yet have Clerk. The "minimal path" is broken at the most important step. | Add a 6-line `jose` (or equivalent) HS256 snippet that signs a token with the project secret. Keep the Clerk path as the secondary example. |
| VOICE-1 | High | `pages/concepts/projects.md:22-29`, `pages/introduction/what-is-flux.md:18` | "Operators typically: Create / destroy projects, Run migrations, Rotate secrets …" then "Developers consume the Service URL …". On hosted Flux, the **app builder** does all of those — calling them an "operator" contradicts [`reader-audiences.md`](../../_contract/reader-audiences.md), which reserves "operator" for the self-hosted ops reader. Same shape on `what-is-flux.md` ("Operators and apps interact with Flux at three layers"). | Replace "Operators" with "you" or "From the CLI or dashboard, you typically …". Drop the artificial Operator vs Developer split. |
| VOICE-2 | High | `pages/reference/env-vars.md:58` | One paragraph names "Sarah-the-app-builder" and "Justin-the-operator." These personas appear nowhere else in the docs and are not codified in `_contract/reader-audiences.md`. Reader sees an inside joke. | Either codify the personas in `reader-audiences.md` so they can be used elsewhere, or rewrite the sentence without proper names. |
| EX-2 | High | `pages/examples/multi-tenant-app.md` (44 lines) | IA promises "tenant-aware application design / JWT claims / RLS ownership / project-aware architecture." Page delivers an RLS policy and a one-line claim-shape note. Architecture and claim wiring are missing. | Add the JWT-claim → tenant_id wiring and a request that proves the policy fires. Consider deferring to `examples/bloom-atelier.md` once that one is rebuilt (EX-1). |
| EX-3 | High | `pages/examples/simple-crud.md` (53 lines) | Two `curl` snippets and a SQL block. Allowed to be intentionally minimal per [examples-review heuristics](../examples-review.md), but currently does not state auth at all (`<TOKEN>` placeholder is undefined). Vertical slice is incomplete. | Add a 2-line "where the token comes from" note (link to first-request) and a "what you should see back" example response. Keep it small. |
| EX-4 | High | `pages/examples/*` (cross-example) | Four placeholder schema names appear across the three examples and concept pages: `t_<12-hex-shortid>_api` (canonical), `t_<shortId>_api`, `t_<short>_api`, `t_abc123_api`, `t_shortid_api`. No two examples agree. | Pick one canonical placeholder (recommend `t_5ecfa3ab72d1_api` to match the format used in `AGENTS.md`) and replace globally. **Also COG-4.** |
| CONTRACT-3 | High | `_contract/_template.md`, `_contract/frontmatter.md`, all 37 pages in `pages/` | The template lists `title`, `description`, `section`, `order` as required frontmatter. The frontmatter contract is truncated (CONTRACT-1). The grep shows **every page sets exactly two frontmatter keys (`title` + `description`); zero set `section` or `order`.** Either the contract is wrong or every live page is violating it. | Decide which is real. If `section`/`order` matter for navigation, backfill them (and have CI lint for it). If not, drop them from `_template.md` and reflect that in `frontmatter.md`. |
| CONTRACT-5 | High | `_contract/information-architecture.md` (multiple section descriptions) | The IA contract uses "operators" framing in section descriptions, which seeds VOICE-1 in the pages that mirror it. The reader-audiences contract says default reader is the **app builder**. | Sweep the IA contract: replace "operators" addressed-to-default-reader with "you" / "the CLI or dashboard" / "the platform". Keep "operator" only where the section is explicitly self-hosted-ops. |
| IA-6 | Medium | `pages/index.md:43-51` | The homepage `## Minimal workflow` ships a 6-line bash chain that depends on `FLUX_API_BASE` and `FLUX_API_TOKEN` — env vars the reader has not been told about yet. The IA section contract for `/docs (root)` says "should NOT include exhaustive CLI examples." Not exhaustive, but premature. | Replace with a 3-line conceptual preview ("install → create → push → call") and link to Installation. Move the runnable chain there. |
| COG-3 | Medium | 15 pages contain "flux list"-bearing prose (full list in [Cognitive pass artifacts](#cognitive-pass-artifacts)) | The "use your real slug and hash from `flux list`" disclaimer appears on 8+ pages, often twice per page. Cumulatively the prose feels defensive. | Promote the explanation into one canonical section ("Project selectors: `--project` and `--hash`") in `pages/reference/config.md`. Replace each repetition with a one-line link to that section. |
| COG-5 | Medium | `pages/getting-started/first-request.md:40-42` | The sentence "If you opened this page from the dashboard 'Pooled stack' helper, your slug and hash may appear in the query string" assumes the reader entered docs from a specific dashboard control. Most readers arrive from search or sidebar nav. | Move to a `> Tip:` callout or remove. The page should not branch on entry path. |
| VOICE-3 | Medium | `pages/architecture/request-flow.md:43` | The "Example" reads: "For internal health checks from the **control plane**, prefer probing via the **gateway** with correct `Host` headers." Pure operator material on a page meant to build the app builder's mental model. | Replace with a debugging cue framed for the reader: "Empty result vs 401 vs 403 — which arrow lit up? Use this page to triage." |
| VOICE-4 | Medium | `pages/architecture/flux-v2.md:39-40` | The "Example" reads: "When you see connection spikes on the shared cluster, you scale or split clusters operationally …". Operator-only on a trust-building page. | Reframe so the app builder reads it as "the platform owns this response (rate limits, connection limits, cluster scaling), not your app code." |
| VOICE-5 | Medium | `pages/reference/cli.md:38,43`, `pages/reference/config.md:28,30` | "Codex" is referenced four times across two reference pages (`Codex / internal docs describe hashing`, `GET /api/cli/v1/codex`, `### Codex / assistant rules`, `FLUX_CODEX_JSON`). Not defined in `_contract/terminology.md`. Reader sees an undefined term twice. | Either add a Codex entry to terminology (one paragraph) or remove the references from public docs. |
| TROUBLE-3 | Medium | `pages/getting-started/first-request.md:64-70` "Common errors" table | Once a canonical troubleshooting page exists (IA-3), this table should link into it rather than ship its own causes. Other "Common errors" callouts (mental-model, request-flow, bridge-jwts, rls-boundaries) drift the same way. | After IA-3, rewrite each "Common errors" block as a 3-row table linking to canonical entries. |
| TROUBLE-4 | Medium | corpus-wide | The hosted-vs-self-hosted ownership split is well-articulated only in `pages/guides/v2-to-v1-migrate.md` (Troubleshooting section). Other pages with operator-shaped advice (`production-hardening.md`, the planned troubleshooting page) should follow the same split. | When the canonical troubleshooting page is built (IA-3), require an "Owner: hosted / self-hosted" column on every entry. Backfill `production-hardening.md`. |
| CONTRACT-4 | Medium | `_contract/information-architecture.md:1, 67`, others | File opens with a stray ```` ```md ```` fence on line 1 and contains other unclosed inner fences. Render-irrelevant (file is contributor-only) but reads as broken in any Markdown preview. | 2-minute cleanup: close fences, remove the outer ```` ```md ```` wrapper. |
| CONTRACT-6 | Medium | `_contract/voice.md` | The voice contract is silent on pronouns and the operator-vs-app-builder distinction. The pages already follow the de-facto rule (zero `we`/`our`/`us` matches across `pages/` — see [Voice pass artifacts](#voice-pass-artifacts)) but the rule is not codified, so future drift is undefended. | Add a short "Pronouns" section to `voice.md`: use *you* for the app builder; use *the platform* / *the control plane* / *Flux* for what the system runs; avoid *we*; use *operator* only inside scoped self-hosted callouts. |

---

## IA pass artifacts

### Tree changes

- **Add** `pages/architecture/v2-specification.md` (promote from top-level `docs/flux-v2-architecture.md`). Justification: four pages link to it as the authoritative spec; the link is currently broken (IA-1).
- **Add** a Troubleshooting slot. Recommend `pages/reference/troubleshooting.md` and a corresponding section in `_contract/information-architecture.md`. Justification: error symptoms have no canonical home today (IA-3 / TROUBLE-1).
- **Consider promoting** `docs/production-security-audit.md` and `docs/OPERATIONS.md` into `pages/` (likely `pages/security/audit.md` and `pages/reference/operations.md`) so `production-hardening.md:26-27` can use in-docs links. Or remove the references.
- **No moves required** beyond the above.

### Broken links found

| Source page (line) | Target | Status |
|--------------------|--------|--------|
| `pages/architecture/flux-v2.md:12` | `/docs/architecture/flux-v2-architecture` | missing |
| `pages/architecture/flux-v2.md:20` | `/docs/architecture/flux-v2-architecture` | missing |
| `pages/security/threat-model.md:8` | `/docs/architecture/flux-v2-architecture` | missing |
| `pages/security/tenant-isolation.md:30` | `/docs/architecture/flux-v2-architecture` | missing |
| `pages/getting-started/auth.md:22` | `/docs/architecture/flux-v2-architecture` | missing |

Repo paths leaked into the body of default-reader pages (treated as broken from the reader's POV):

| Source page (line) | Repo path |
|--------------------|-----------|
| `pages/guides/authjs.md:30` | `docs/guides/flux-nextjs-authjs-rls.md` |
| `pages/guides/clerk.md:20` | `docs/guides/clerk-integration.md` |
| `pages/guides/nextjs.md:22` | `docs/guides/flux-nextjs-v2-shared-quickstart.md` |
| `pages/guides/production-hardening.md:26` | `docs/production-security-audit.md` |
| `pages/guides/production-hardening.md:27` | `docs/OPERATIONS.md` |

---

## Cognitive pass artifacts

### Term coverage

| Term first appearance | Defined where | Linked from page? |
|-----------------------|----------------|--------------------|
| **Service URL** in `installation.md:18` | `_contract/terminology.md` and `concepts/service-urls.md` (downstream) | No — see COG-1 |
| **Codex** in `reference/cli.md:38` | Not defined anywhere | No — see VOICE-5 |
| **Bridge JWT** in `getting-started/auth.md:19` | `_contract/terminology.md` and `concepts/jwt-auth.md`, `architecture/bridge-jwts.md` (downstream) | Yes (page links to architecture/bridge-jwts on line 21) — fine |
| **Tenant schema** placeholders | Format in `reference/env-vars.md:73`; usage drifts in 5+ places | N/A — drift, see EX-4 / COG-4 |

### Reader walk-through

Reading the corpus aloud as the **app builder on hosted Flux**:

- **Introduction → Mental model**: Strong. The ASCII request-lifecycle diagram does the heaviest lift in the docs. Stays calm, names the four parts, doesn't lecture.
- **Getting Started → Installation**: Friction at "Service URL" first use (COG-1) and at the `flux push --project … --hash …` block, where the reader has no idea where slug/hash come from until `create-project.md` (the next page).
- **Getting Started → First request**: This is where the reader stalls. They have a project, they have a Service URL, they have a `<token>` placeholder, and the page never tells them how to make a token unless they're already on Clerk (COG-2). This is the single highest-leverage cognitive fix.
- **Concepts → Projects**: The "Operators typically …" / "Developers consume …" split (VOICE-1) lands as: "wait, am I the operator or the developer?" The reader is both, on hosted Flux. Confidence dips for one paragraph.
- **Architecture pages**: All four read well as a sequence — the trust-building does what the IA promised. The "Example" sections on `request-flow.md` and `flux-v2.md` are the wobbles (VOICE-3, VOICE-4).
- **Security → Threat model**: Calm, honest, builds trust. Broken link to `flux-v2-architecture` (IA-1) is the only damage.
- **Guides**: `v2-to-v1-migrate.md` and `v1-dedicated-sql-workflows.md` are the two strongest reader pages in the corpus. The `authjs`, `clerk`, `nextjs` stubs (IA-2) feel like placeholders next to them.
- **Examples**: The reader expects the payoff here. Doesn't get it (EX-1, EX-2, EX-3).
- **Reference → env-vars**: Excellent quality and structure. The sole place "Sarah-the-app-builder" appears (VOICE-2) is jarring against the otherwise pronoun-free corpus.

Pages where "use your real slug and hash from `flux list`" or equivalent disclaimer appears (15 total): `pages/index.md`, `pages/getting-started/installation.md`, `pages/getting-started/create-project.md`, `pages/getting-started/first-request.md`, `pages/concepts/projects.md`, `pages/concepts/migrations.md`, `pages/concepts/service-urls.md`, `pages/examples/bloom-atelier.md`, `pages/guides/migrations.md`, `pages/guides/nextjs.md`, `pages/guides/v1-dedicated-sql-workflows.md`, `pages/guides/v2-to-v1-migrate.md`, `pages/reference/cli.md`, `pages/reference/config.md`, `pages/reference/env-vars.md`. All would link to one canonical "Project selectors" section if it existed (COG-3).

---

## Voice pass artifacts

### Hype-word scan

`magical|seamless|effortless|blazing|revolutionary|supercharged|enterprise-grade|AI-powered` (case-insensitive) across `docs/pages/`:

**Zero matches.** Voice contract on hype is being respected.

`magic` appears once in `pages/security/tenant-isolation.md:30` ("not 'magic'") — used to *deny* magic, which is the contract's recommended framing. No finding.

### Pronoun and persona scan

| Issue | Page (line) | Hits | Action |
|-------|-------------|------|--------|
| `we` / `our` / `us` | corpus | **0** | None — the de-facto rule is already perfect. Codify in `voice.md` (CONTRACT-6) so it stays that way. |
| `Operators typically …` addressing default reader | `pages/concepts/projects.md:22` | 1 | Rewrite (VOICE-1). |
| `Operators and apps interact with Flux …` addressing default reader | `pages/introduction/what-is-flux.md:18` | 1 | Rewrite (VOICE-1). |
| `Developers consume …` paired split with Operators | `pages/concepts/projects.md:29` | 1 | Rewrite as part of VOICE-1. |
| Named persona `Sarah-the-app-builder` / `Justin-the-operator` | `pages/reference/env-vars.md:58` | 1 | Codify or rewrite (VOICE-2). |
| `operator` inside an explicit operator callout (acceptable) | `pages/guides/v2-to-v1-migrate.md:116, 123, 130, 137`, `pages/guides/production-hardening.md:29`, `pages/reference/env-vars.md:10, 245` | several | No finding — these are properly scoped. |

### Tone read

The opening paragraph of every page reads as a calm infrastructure manual. Two pages drift to operator-shaped framing in their "Example" section (`request-flow.md`, `flux-v2.md` — VOICE-3, VOICE-4). No page drifts to launch-tweet or stand-up tone. Tone discipline is the corpus's biggest unforced strength.

---

## Examples pass artifacts

### IA-promise coverage

| Example | IA contract promised | Demonstrated in current page | Missing |
|---------|----------------------|-------------------------------|---------|
| `pages/examples/bloom-atelier.md` | "complete real-world Flux application … auth, migrations, RLS, API usage, image handling, multi-user behavior" | Hostname pattern only | auth, migrations, RLS, API usage, image handling, multi-user — i.e. **all of it** (EX-1) |
| `pages/examples/multi-tenant-app.md` | "tenant-aware application design / JWT claims / RLS ownership / project-aware architecture" | RLS policy, claim-shape mention | JWT-claim → tenant_id wiring, request that proves the policy fires, project-aware architecture (EX-2) |
| `pages/examples/simple-crud.md` | "smallest meaningful vertical slice" | SQL + 2 curls | Auth wiring even minimal, expected response (EX-3) |

### Cross-example consistency

| Element | Values found across `pages/` | Canonical | Action |
|---------|-------------------------------|------------|--------|
| Tenant schema placeholder | `t_<12-hex-shortid>_api` (env-vars.md:73) · `t_<shortId>_api` (6 pages) · `t_<short>_api` (pooled-vs-dedicated.md:30) · `t_abc123_api` (rls.md:27,29; migrations.md:37) · `t_shortid_api` (simple-crud.md:25,31; multi-tenant-app.md:27,29) | Recommend `t_5ecfa3ab72d1_api` to match `AGENTS.md` examples | Replace globally (EX-4 / COG-4) |
| Fictional project slug | `bloom-atelier` (examples/bloom-atelier.md, guides/v2-to-v1-migrate.md) · `percept` (index.md, getting-started/*, reference/cli.md) · `billing-svc` (concepts/projects.md) · `myapp` (guides/nextjs.md) | Pick one and reuse — recommend `bloom-atelier` to match the canonical sample slug in `AGENTS.md` and `cursorrules` | Decide first; sweep second |
| JWT claim shape | `{ role, sub }` (concepts/jwt-auth.md) · `{ role, sub, org_id }` (examples/multi-tenant-app.md) | Two shapes is fine if intentional; document why | No action — flag for the next examples-review |

---

## Troubleshooting pass artifacts

### Symptom inventory

| Symptom | Pages mentioning it | Canonical entry exists? | Engine | Suggested owner |
|---------|---------------------|-------------------------|--------|-----------------|
| `401` | `getting-started/first-request.md`, `introduction/mental-model.md`, `architecture/bridge-jwts.md`, `architecture/request-flow.md`, `security/authentication-model.md` | **No** | both | app builder (token / audience) |
| `403` / `42501` | `getting-started/first-request.md`, `introduction/mental-model.md`, `architecture/bridge-jwts.md`, `architecture/request-flow.md`, `concepts/rls.md`, `security/rls-boundaries.md`, `examples/multi-tenant-app.md`, `guides/v2-to-v1-migrate.md` | **No** | both | app builder (GRANT / RLS) |
| Empty array | `getting-started/first-request.md`, `introduction/mental-model.md`, `architecture/request-flow.md`, `concepts/rls.md`, `security/rls-boundaries.md` | **No** | both | app builder (filters / type drift) |
| `pg_dump not found` | `guides/v2-to-v1-migrate.md`, `guides/production-hardening.md` | Yes (in v2-to-v1-migrate.md) — but lives inside a guide, not a canonical entry | both | hosted: support; self-hosted: operator |
| `invalid command \restrict` | `guides/v2-to-v1-migrate.md` | Yes (in same guide) | both | hosted: support; self-hosted: operator |
| `role "service_role" does not exist` | `guides/v2-to-v1-migrate.md` | Yes (in same guide) | dedicated tenant DB | hosted: support; self-hosted: operator |
| TLS chain (`NODE_EXTRA_CA_CERTS`) | `concepts/service-urls.md`, `security/project-secrets.md`, `guides/production-hardening.md`, `reference/env-vars.md` | Partial — `env-vars.md` has the strongest entry | both | app builder |

The first three rows are the urgency: every reader hits one of `401` / `403` / empty-array, and there is currently no page they can land on to triage. The last four entries are well-handled inside `v2-to-v1-migrate.md` but should be linkable from a canonical page.

---

## Contract repairs (meta findings)

These are findings about `_contract/` itself rather than `pages/`. They live separately because they affect future contributor work, not the rendered docs.

| ID | Severity | File | Action |
|----|----------|------|--------|
| CONTRACT-1 | Blocker | `_contract/frontmatter.md` | Finish the truncated file. |
| CONTRACT-2 | Blocker | `_contract/diagrams.md` | Repair fences; decide SVG-or-text-first scope. |
| CONTRACT-3 | High | `_contract/_template.md` + `_contract/frontmatter.md` + 37 pages | Reconcile the `section`/`order` requirement (currently 0/37 live pages set them). |
| CONTRACT-5 | High | `_contract/information-architecture.md` | Sweep "operators" framing in section descriptions; replace with reader-aware verbs. |
| CONTRACT-4 | Medium | `_contract/information-architecture.md` | Remove stray `` ```md `` outer fence and close inner fences. |
| CONTRACT-6 | Medium | `_contract/voice.md` | Add a Pronouns section codifying the de-facto rule (zero `we`/`us`/`our` in `pages/` today). |

---

## Recommended fix order

The order below clears the highest-leverage reader friction first and leaves the larger writing tasks for last.

1. **IA-1** — promote `flux-v2-architecture.md` into `pages/architecture/v2-specification.md`. Five-minute Markdown move, fixes four broken links.
2. **CONTRACT-1, CONTRACT-2, CONTRACT-4** — repair the three malformed contract files. Cheap and unblocks contributors.
3. **IA-2** — pull `flux-nextjs-authjs-rls.md`, `clerk-integration.md`, `flux-nextjs-v2-shared-quickstart.md` into `pages/guides/{authjs,clerk,nextjs}.md`. The biggest reader-facing improvement per hour spent.
4. **IA-3 / TROUBLE-1** — add `pages/reference/troubleshooting.md` and the corresponding IA contract slot. Pull the 401 / 403 / `42501` / empty-array material from the six pages currently spreading it. Update those pages to link in.
5. **COG-2** — add the token-minting snippet to `getting-started/first-request.md`. Single-paragraph fix; closes the loop on the IA's "psychologically important" page.
6. **VOICE-1, CONTRACT-5, CONTRACT-6** — de-operator the three pages and the IA contract section descriptions; add the Pronouns section to `voice.md`. Done together so the contract leads the page rewrites.
7. **EX-4 / COG-4** — choose canonical placeholders (schema name + fictional slug) and sweep the corpus.
8. **COG-3** — add a "Project selectors" section in `reference/config.md`; replace the 15 disclaimer copies with one-line links.
9. **IA-4, VOICE-2, VOICE-3, VOICE-4, VOICE-5** — the smaller polish set.
10. **EX-1** — rebuild Bloom Atelier as the promised end-to-end app, **only after the user confirms scope**. Largest single piece of writing in the list.

CONTRACT-3 (`section`/`order`) needs a decision before action — call out as an open question rather than scheduling work for it.

---

## Open questions

- **CONTRACT-3 decision**: do `section` and `order` matter for navigation? If yes, backfill 37 pages and add a CI lint. If no, drop them from `_template.md` and reflect in `frontmatter.md`. Cheaper to drop.
- **EX-1 scope**: rebuild `bloom-atelier.md` as the promised worked app, or repurpose the slot? Affects whether the canonical-slug consistency sweep (EX-4) should also rename the example.
- **IA-4 disposition for `production-security-audit.md` and `OPERATIONS.md`**: promote into `pages/` (and run them through cognitive + voice passes), or strike the references and accept that those documents remain repo-only?
- **VOICE-5 disposition for "Codex"**: define in terminology, or strip from public docs? Currently it appears as an undefined term twice in the reference section.

---

## Scope and what was deferred

- **Technical truth pass not run.** This report does not verify CLI flag names, env var loaders, hostname parser regex, role names, schema generator output, or default values against the codebase. Several findings (especially in `pages/reference/env-vars.md`, `pages/reference/cli.md`, `pages/reference/config.md`, `pages/architecture/*`) stand a real chance of carrying outdated facts. Reserve a full Opus pass per [`technical-truth.md`](../technical-truth.md) before treating the reference and architecture pages as stable.
- **Each `Common errors` table not individually verified** against the throw sites in code. Done as part of TROUBLE-1's canonical-page work, in tandem with the Opus truth pass.
- **No live `flux` CLI run.** Subcommand and flag verification deferred to the truth pass.
- **No examples re-execution.** The HTTP examples in `pages/examples/simple-crud.md` and the bash examples in `pages/getting-started/*` were read for shape, not run end-to-end.
- **`docs/_contract/_template.md` and the older `docs/information-architecture.md` pointer file** were read but generated no findings beyond what is captured under CONTRACT-1..6.

---

## Notes

- The `docs/_review/` system itself was created in the same change cycle as this report. This is therefore both the inaugural report and a worked example of the report skeleton; future reports should drop the explanatory framing and stay closer to the standard shape in [`README.md`](../README.md).
- Severity calibration in this report leans conservative on `Blocker` (5 findings) — every Blocker is either a broken link or a contract file that contributors are about to read. Future reports should keep the same bar: a Blocker means "do not ship until fixed."
- The corpus is in better shape than the finding count suggests. Two of the standard rubrics (hype-word scan, pronoun scan) returned cleanly, and the architecture and security pages do real trust-building work that few docs systems achieve. The finding count is high because the IA contract and reader-audiences contract are demanding — which is the point of having them.

---

## Corrections

This section records corrections to the report after publication. Each correction names the original finding, what was wrong, the source of truth that revealed it, and the consequence for the recommendation.

### 2026-05-08 — IA-1 ("broken link") was a false positive

**Original finding.** IA-1 reported five reader-facing pointers to `/docs/architecture/flux-v2-architecture` as Blockers because no `pages/architecture/flux-v2-architecture.md` exists.

**What was wrong.** The URL **does** resolve in production. `apps/dashboard/src/lib/docs-content.ts:18-29` defines a `REPO_DOC_ALIASES` map that loads the slug `architecture/flux-v2-architecture` from the top-level `docs/flux-v2-architecture.md`, with title and description supplied by a `REPO_DOC_ALIAS_METADATA` overlay since the source file has no frontmatter. The page is also wired into the nav at `apps/dashboard/src/lib/docs-nav.ts:47-50` as "V2 specification (full)".

**How it was missed.** This was an **IA pass artifact running without the technical truth pass**. The IA pass walks `docs/pages/` and the file list; it does not read renderer code. The dashboard's special-case alias loader is exactly the kind of runtime behavior the [technical-truth pass](../technical-truth.md) is designed to surface. Deferring that pass while still calling broken-link findings "Blockers" was the mistake.

**Consequence for the recommendation.** The corrective work is the same — promote the file into `pages/`, rewrite for the reader, fold it into the standard load path — but the framing changes:

- This is **not** about restoring a broken page. The page already renders.
- It **is** about ending a special-case escape hatch, pulling the page into the IA tree, and replacing repo voice with docs voice.
- After the move, the alias entries in `docs-content.ts` and the title in `docs-nav.ts` need updating; otherwise the loader's alias path takes precedence over the new `pages/` file and the rewrite would be dead code.

**Severity reclassification.** IA-1 is downgraded from **Blocker** to **High**. Still in the same fix-order slot (step 1), but no longer "do not ship until fixed."

**Lesson recorded.** Severity for any finding that depends on runtime behavior should be deferred until the truth pass runs. The IA pass can flag the suspicion; only the truth pass earns the Blocker label.
