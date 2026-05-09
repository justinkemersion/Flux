# docs/_review/baselines.md

# Documentation baselines

This file records the **state of the documentation corpus** at the moments that matter: the inaugural governance pass, major systemic fixes, terminology shifts, and other governance milestones.

It is institutional memory. It is not a changelog of every page edit; it is the short list of moments where the docs system itself moved.

## Why this file exists

Future contributors and reviewers need to know:

- What did the corpus look like when a major rule was introduced?
- When did `<term>` become canonical?
- When did `<rule>` go from "aspirational" to "enforced"?
- When did the contract or review system itself change shape?

Without this file, that history is reconstructed by archaeology in commit logs. With it, the next reviewer can read 60 seconds of context and start from the right baseline.

## Format

One section per dated entry. Newest at the top. Each entry covers:

1. **Context** — a one-line description of what happened.
2. **Key discoveries** — what the corpus already did right, and what it didn't (so the bar is visible).
3. **Decisions of record** — explicit calls made in this cycle, with the alternative that was rejected.
4. **Structural changes initiated** — what the cycle started; not necessarily what it finished.

Keep entries short. If a single entry needs more than a screen, it probably wants its own report under [`reports/`](reports/) and a one-paragraph summary here.

---

## 2026-05-08 — inaugural governance pass

**Context.** First time the documentation review system was applied to the corpus. Triggered by a deliberate review of `docs/pages/` and `docs/_contract/` against the reader-audiences and IA contracts. Produced [`reports/2026-05-08-initial-review.md`](reports/2026-05-08-initial-review.md).

### Key discoveries

What the corpus already did right (these set the bar going forward):

- **Zero hype-language drift** across `docs/pages/`. The voice contract on banned vocabulary (`magical`, `seamless`, `effortless`, `blazing`, `revolutionary`, `supercharged`, `enterprise-grade`, `AI-powered`) is operationally — not aspirationally — respected.
- **Zero `we` / `our` / `us` drift** across `docs/pages/`. The de-facto pronoun rule (use *you* for the reader, name the platform explicitly) is already perfect.
- Architecture and security pages do real trust-building work that few docs systems achieve.
- `pages/reference/env-vars.md`, `pages/guides/v2-to-v1-migrate.md`, and `pages/concepts/pooled-vs-dedicated.md` were exemplars of the calm-manual tone the contract asks for.

What the corpus did not do right:

- **Major canonical-link failures.** Five reader-facing pointers in `pages/` resolved to nothing — primarily a missing `/docs/architecture/flux-v2-architecture` referenced from four pages, plus three named guides (`authjs`, `clerk`, `nextjs`) that deferred to repo paths the reader could not open.
- **Troubleshooting knowledge fragmented.** The most useful reader content (401 / 403 / `42501` / empty array) was scattered across six pages with no canonical home and no IA slot.
- **Operator-vs-app-builder leakage.** Two pages (`concepts/projects.md`, `introduction/what-is-flux.md`) framed the default reader as an "operator" — contradicting [`reader-audiences.md`](../_contract/reader-audiences.md) — because the IA contract itself used "operators" framing in section descriptions.
- **Contract files in disrepair.** `_contract/frontmatter.md` was truncated mid-thought; `_contract/diagrams.md` had unclosed code fences; `_contract/_template.md` required four frontmatter fields that zero of the 37 live pages set.
- **Examples slot under-delivered.** All three example pages were thinner than what their IA section contract promised.
- **Schema-name placeholder drift.** Five different placeholder forms appeared in the corpus for the same concept.

### Decisions of record

Resolved during this pass; alternative explicitly rejected.

| Question | Decision | Alternative rejected |
|----------|----------|----------------------|
| **CONTRACT-3** — keep `section` and `order` as required frontmatter? | Keep `section` required; drop `order` to optional. Backfill `section` across 36 pages. | Backfill `order` across 37 pages (rejected: filesystem hierarchy is the real ordering system; numeric order metadata creates duplication, drift, and contributor hesitation). |
| **EX-1** — rebuild `bloom-atelier.md` or repurpose the slot? | Rebuild as a **guided architectural walkthrough** (10 numbered steps, not a full codebase dump). Use Bloom Atelier as the canonical fictional project across the corpus. | Repurpose to a generic "notes app" example (rejected: Bloom uniquely exercises systems-thinking, identity, trust, multi-user boundaries, and editorial content — not just CRUD). |
| **IA-4** — promote `production-security-audit.md` and/or `OPERATIONS.md` into `pages/`? | Promote `production-security-audit.md` (rewrite into docs voice). Do **not** promote `OPERATIONS.md` — extract any externally useful content into `pages/guides/production-hardening.md` and keep the rest internal. | Promote both (rejected: `OPERATIONS.md` is internal operational process; promoting it would cause audience bleed and operator drift in hosted-reader flows). |
| **VOICE-5** — define "Codex" in terminology or strip it from public docs? | Define minimally in `_contract/terminology.md` as "Flux's structured machine-readable project metadata format" intended for tooling and automation, not application runtime behavior. | Strip from public docs (rejected: leaving the term undefined creates hidden architecture and reader suspicion of internal machinery). |

### Structural changes initiated

- **[`docs/_review/`](.) review system established** — six rubric files (`ia-review.md`, `cognitive-load.md`, `technical-truth.md`, `voice-review.md`, `examples-review.md`, `troubleshooting-review.md`) plus this baselines file and the `README.md` defining the four-pass pipeline.
- **Inaugural review report archived** at [`reports/2026-05-08-initial-review.md`](reports/2026-05-08-initial-review.md).
- **Frontmatter contract reconciliation** — `_contract/frontmatter.md`, `_contract/_template.md`, and per-page frontmatter aligned around `title` + `description` + `section` (required) and `order` + `tags` + `status` (optional).
- **Contract file repairs** — `_contract/diagrams.md` fences closed and scope clarified; `_contract/information-architecture.md` outer fence stripped.
- **10-step repair order published** in the inaugural report (see [`reports/2026-05-08-initial-review.md`](reports/2026-05-08-initial-review.md) → "Recommended fix order"). Execution begins after this baseline is recorded.

### What remains aspirational after this pass

- **Pronoun rule** — codified in `voice.md` (CONTRACT-6) but the corpus already follows it cleanly. Codification defends against future drift, not present drift.
- **Operator-vs-app-builder discipline** in the IA contract section descriptions (CONTRACT-5) — the contract still nudges the wrong framing in places; sweep is queued in the repair order.
- **Technical truth pass** has not yet run on this corpus. Reference and architecture pages are not yet verified against the codebase. First Opus truth pass is queued; until it lands, treat fact-shaped claims in `pages/reference/` and `pages/architecture/` as plausible-but-unverified.

### Mid-cycle correction: IA-1 reclassified

After the inaugural report was published, work on the IA-1 fix surfaced that the "broken link" framing was wrong. The dashboard at `apps/dashboard/src/lib/docs-content.ts` has a `REPO_DOC_ALIASES` map that loads `/docs/architecture/flux-v2-architecture` from the top-level `docs/flux-v2-architecture.md`; the URL renders in production. IA-1 is **downgraded from Blocker to High**, and the fix-order step changes from "restore broken link" to "pull the page into the IA tree, replace repo voice with docs voice, and end the special-case alias." Full correction recorded at [`reports/2026-05-08-initial-review.md`](reports/2026-05-08-initial-review.md) → "Corrections".

**Lesson for the system.** Severity for any finding that depends on runtime behavior should be deferred until the [technical-truth pass](technical-truth.md) runs. An IA-pass-only Blocker is a contradiction in terms when the file might be loaded through a non-canonical path the IA pass cannot see. The pass-ordering rule in [`README.md`](README.md) ("IA → cognitive → truth → editorial") is correct precisely so the truth pass can deflate or upgrade the earlier passes' suspicions before they ship as Blockers.

### IA-2 closeout

The three named guides — `pages/guides/{authjs,clerk,nextjs}.md` — were rewritten as full standalone guides using the substantive content from the now-retired repo-internal originals (`docs/guides/flux-nextjs-{v2-shared-quickstart,authjs-rls}.md`, `docs/guides/clerk-integration.md`). The originals were deleted; AGENTS.md, root README, OPERATIONS, and the surviving sibling guide were updated to point at the public docs paths. The dashboard sidebar was reordered so Next.js (the prerequisite) precedes Auth.js and Clerk. Single source of truth restored under `docs/pages/guides/`.

### Backups feature surfaced in docs (mid-cycle addition)

Backups had shipped in code (v1 nightly + on-demand, v2 on-demand tenant exports, the trust classifier in `@flux/core/backup-trust`, restore-verification in a disposable Postgres, optional offsite replication, the `flux nuke --skip-backup-check` destructive-action gate) but were only mentioned in scattered footnotes across `pooled-vs-dedicated.md`, `v1-dedicated-sql-workflows.md`, `flux-v2-architecture.md`, and a single CLI table row. The trust model itself had no public-facing definition.

This pass added the missing surface as a clean concept-plus-guide pair (per the established corpus pattern that separates "what" from "how"):

- `concepts/backups.md` — canonical concept page. Defines the two backup shapes (`project_db` on v1, `tenant_export` on v2), the **three trust states** (artifact validated → restore-verified → offsite replicated), what backups guarantee and what they do not (the DR boundary), how trust gates `flux nuke`, and where backups physically live (with the operator concerns punted to production-hardening).
- `guides/backups.md` — practical workflow. Walks `create / list / verify / download` and the manual restore path for each engine (`pg_restore` against `flux project credentials` for v1; `pg_restore` against any Postgres of the same major version for v2 tenant exports). Closes with the pre-destructive workflow pattern and a CI snippet.

The trust language decision (recorded under "Decisions of record" in this entry): expose the **three meaningful states** publicly (`artifact validated`, `restore-verified`, `offsite replicated`) rather than the seven internal classifier tiers. The internal tier names are documented inline in the troubleshooting page's tier-name decoder so readers can map a `--verbose` CLI line to the concept; the concept page itself stays clean.

Cross-corpus updates:

- `reference/cli.md`              expanded backup row to four engine-aware rows (create, list, verify, download)
- `reference/troubleshooting.md`  added "Backup is not restore-verified" and "Backup download fails or refuses to write" entries; updated the opening "Most issues fall into..." list to include the backup category
- `reference/env-vars.md`         no addition (operator env vars belong in production-hardening, not the app-builder env-var page)
- `guides/production-hardening.md`  new "Backup storage and verification (self-hosted only)" section documenting `FLUX_BACKUPS_LOCAL_DIR`, `FLUX_BACKUPS_OFFSITE_DIR`, `FLUX_BACKUP_VERIFY_POSTGRES_IMAGE`
- `concepts/pooled-vs-dedicated.md`, `guides/v1-dedicated-sql-workflows.md`, `architecture/flux-v2-architecture.md`  added link-ins to the new concept/guide rather than re-defining the trust contract locally
- IA contract (`information-architecture.md`)  added `/concepts/backups` and `/guides/backups` section contracts; updated the `/concepts` and `/guides` trees
- Dashboard sidebar (`docs-nav.ts`)  added both pages in their canonical slot

| Decision | Choice | Alternative rejected |
|----------|--------|----------------------|
| Page shape for backups | Concept page + guide page (matches the corpus's "what vs how" split) | Single guide page (rejected: mixes the trust contract with the workflow); concept-only (rejected: leaves the workflow buried in a v1-only SQL page); full `/backups` section (rejected: overbuilds for current scope) |
| Trust language | Expose the three meaningful states (`artifact validated`, `restore-verified`, `offsite replicated`); reference internal tier names only inline in troubleshooting | Document every internal tier verbatim (rejected: exposes implementation details that may churn); expose only `restore-verified or not` (rejected: loses the durability vs. usability distinction the post-v1-v2 plan considers important) |

### IA-3 / TROUBLE-1 closeout

A canonical troubleshooting home was added at `pages/reference/troubleshooting.md`. The page is organized **by reader-observable symptom** (401, 403, empty array, 42501, migration succeeded but queries fail, JWT looks valid but rejected, pooled-specific misunderstandings) rather than by subsystem, and each entry follows a consistent shape: layer / what it means / how to verify / common fixes / engine scope / related pages. A "How to think about Flux failures" section at the top teaches the layer-stack debugging discipline before any individual entry, and a "When the issue is probably not Flux" section at the bottom prevents infrastructure blame inflation.

The IA contract (`information-architecture.md`) gained a `/reference/troubleshooting` slot. The dashboard sidebar gained the same. Six pages that previously spread error material were updated to defer to the canonical entries with brief in-context callouts (per the troubleshooting-review rubric: three rows or fewer, each linking into the canonical entry):

- `pages/getting-started/first-request.md` — error table now links to the three relevant anchors
- `pages/introduction/mental-model.md` — replaced prose 401/403 paragraph with a 3-row symptom table
- `pages/architecture/request-flow.md` — kept the layered framing, added canonical link
- `pages/architecture/bridge-jwts.md` — kept the trust-boundary explanation, added canonical link
- `pages/security/rls-boundaries.md` — added anchored links to the empty-array and 42501 entries
- `pages/guides/v2-to-v1-migrate.md` — kept the migration-specific entries (pg_dump / `\restrict` / service_role) and added a pointer noting that everyday request-time symptoms live in the canonical reference

This collapses the previous duplication: from six pages each carrying a partial cause/resolution, to one canonical page with cross-links from the six contextual sites.

---
