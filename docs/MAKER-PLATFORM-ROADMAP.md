# Flux Maker Platform Roadmap

*Status: Draft*
*Purpose: Product direction and feature sequencing for the next phase of Flux.*

## 1. Working Identity

Flux is a home for application projects built on PostgreSQL.

It is not trying to become a full cloud platform, a general AI coding tool, or a Supabase clone. Flux sits between the maker and PostgreSQL, turning hard operational concepts into simple project workflows:

* create a project
* apply schema changes
* inspect data
* connect safely
* back up and verify
* pause and resume
* understand what exists
* grow into a stronger runtime when the project proves itself

Flux should serve hobbyists, indie makers, and real startups with the same core principle:

> A project should be easy to create, easy to understand, easy to pause, easy to revive, and safe to grow.

The new identity is not a pivot away from the original product. It is a clarification.

Flux is still a PostgreSQL-backed BaaS / DBaaS toolkit. The difference is that the product should now be shaped around the way modern builders actually work: many projects, many experiments, a few active bets, and occasional successful projects that need a clear upgrade path.

## 2. Product Thesis

Modern builders create more projects than ever.

With tools like Cursor, Codex, Copilot, and AI scaffolding, the cost of starting an app has collapsed. A single developer may create dozens of small projects:

* serious products
* weekend tools
* portfolio apps
* experiments
* internal dashboards
* unfinished ideas
* dormant concepts that may matter later

Most infrastructure platforms still behave as if every new project is a production workload. Flux should not.

Flux should make it normal to have many projects, while clearly distinguishing between projects that are merely stored and projects that are actively consuming runtime resources.

The long-term product feeling:

> GitHub is where code projects live.
> Flux is where application projects get their living state.

The database is the anchor, but the product is the project.

## 3. Core Product Principles

### 3.1 Do not make users derive obvious answers

A user should not have to infer where the password is, which schema matters, which command reveals their data, or whether a backup is trustworthy.

Flux should prefer explicit presentation over cleverness.

Bad:

> The password can be derived from the connection string.

Good:

> Password: run `flux db password <project> --hash <hash>`

Better:

> Password: [copy]

### 3.2 Keep PostgreSQL powerful, but make the common path obvious

Flux should not hide PostgreSQL. PostgreSQL is the foundation.

But Flux should translate PostgreSQL concepts into project operations:

* database access
* schema inspection
* row previews
* backups
* migrations
* RLS visibility
* connection handoff
* restore readiness

The user should still be able to drop into `psql`, Beekeeper, DBeaver, TablePlus, or any SQL client. Flux should simply make that path safe and clear.

### 3.3 Do not rebuild every wheel

Flux does not need to become a full SQL IDE.

Specialized SQL viewers already exist. However, Flux does need enough first-party read-only inspection for a user to understand what exists inside a project without leaving the dashboard.

The right boundary:

* yes: schema explorer
* yes: table list
* yes: row preview
* yes: row counts
* maybe later: read-only query runner
* not soon: full SQL editor
* not soon: visual query builder
* not soon: database administration suite

### 3.4 Projects are durable assets, not just running containers

A Flux project should remain meaningful even when it is not active.

A dormant project should still have:

* name
* description / brief
* schema history
* database snapshot or retained data
* backups
* activity timeline
* migration history
* connection metadata
* notes / project brief

A project is not just a running process. It is an application artifact.

### 3.5 AI is additive, not foundational

Flux should not become an AI product first.

AI should appear only where it helps the user understand an existing project faster:

* generate a project brief
* explain a schema
* summarize project activity
* help resume a dormant project
* generate FLUX.md from repo context

If removing AI makes a feature useless, the feature probably does not belong in core Flux yet.

## 4. Roadmap Layers

Flux should evolve in three layers.

```text
Layer 3: Project Understanding
AI-assisted summaries, project briefs, resume context

Layer 2: Project Visibility
Schema explorer, activity timeline, backup status, project overview

Layer 1: Project Infrastructure
Provisioning, migrations, DB access, backups, lifecycle, credentials
```

The next work should strengthen Layers 1 and 2 before attempting ambitious Layer 3 features.

## 5. Priority Feature Set

The following features define the next meaningful stage of Flux.

They are ordered by practical value and alignment with the new identity.

---

# Feature 1: DB Inspection CLI

## Summary

Add first-class CLI commands that answer the basic question:

> What is in my database?

## Why it matters

The recent remote SQL tunnel and temporary credential work made it possible to access project databases safely from external SQL viewers. That was a major step.

But a user should not need to open Beekeeper or `psql` just to learn:

* what tables exist
* what columns exist
* how many rows are present
* whether a project has data at all

DB inspection is the bridge between raw database access and project understanding.

## Proposed Commands

```bash
flux db inspect <project> --hash <hash>
flux db tables <project> --hash <hash>
flux db describe <table> <project> --hash <hash>
flux db counts <project> --hash <hash>
```

## Expected Behavior

### `flux db inspect`

Shows a project-level database overview:

```text
Project: noisydesign
Mode: v2_shared
Schema: t_f361c4681136_api

Tables: 12
Rows: ~1,842

Largest tables:
photos        ~1,204
roll_frames   ~312
rolls           ~18
essays           ~4

Warnings:
none
```

### `flux db tables`

Lists tables:

```text
Table          Columns   Rows     RLS
photos         14        ~1204    enabled
rolls          9         ~18      enabled
essays         8         ~4       disabled
profiles       7         ~1       enabled
```

### `flux db describe photos`

Shows schema details:

```text
Table: photos

Columns:
id              uuid         not null default gen_random_uuid()
title           text         nullable
image_url       text         not null
roll_id         uuid         nullable
created_at      timestamptz  not null default now()

Primary key:
photos_pkey (id)

Foreign keys:
roll_id -> rolls.id

Indexes:
photos_pkey
photos_roll_id_idx
```

### `flux db counts`

Shows row counts:

```text
photos          ~1204
roll_frames      ~312
rolls             ~18
essays             ~4
profiles           ~1
```

Default should use approximate counts where possible. Exact counts should require an explicit flag:

```bash
flux db counts noisydesign --hash <hash> --exact
```

## Constraints

* Must be read-only.
* Must not accept arbitrary SQL.
* Must safely validate identifiers.
* Must scope v1 to the project API schema.
* Must scope v2 to the tenant schema only.
* Must reuse existing safe DB access primitives where possible.
* Must not expose pooled admin credentials.

## Acceptance Criteria

* A user can inspect a project without opening `psql`.
* Empty projects display a helpful message.
* v1 and v2 projects both work.
* Invalid table names are rejected safely.
* Approximate counts are fast.
* Exact counts are clearly marked as potentially slower.
* The output is useful to a beginner.

---

# Feature 2: Dashboard Schema Explorer

## Summary

Add a read-only schema explorer to the dashboard project page.

## Why it matters

The CLI is powerful, but a maker returning to a dormant project often wants to click around and remember what exists.

This is not a SQL IDE. It is a project memory tool.

A user should be able to open a project and immediately see:

* schemas
* tables
* columns
* primary keys
* foreign keys
* RLS state
* rough row counts

## Proposed UI Placement

Inside the project detail page:

```text
Project
├─ Overview
├─ Database
│  ├─ Tables
│  ├─ Schema
│  └─ Backups
├─ API
├─ Activity
└─ Settings
```

Or, if keeping the current UI simpler:

```text
Project Detail
├─ Database Tools
│  ├─ Schema
│  ├─ Data Preview
│  ├─ Backups
│  └─ Connect
```

## Expected Experience

The user clicks a project, then clicks Database.

They see:

```text
Tables

photos          14 columns   ~1204 rows
rolls            9 columns     ~18 rows
essays           8 columns      ~4 rows
profiles         7 columns      ~1 row
```

Clicking `photos` shows:

```text
photos

Columns
id              uuid
title           text
image_url       text
roll_id         uuid
created_at      timestamptz

Relationships
roll_id -> rolls.id

Security
RLS enabled
```

## Constraints

* Read-only.
* No arbitrary SQL.
* No table editing.
* No destructive actions.
* Use the same schema-inspection primitives as the CLI.
* v2 must never leak other tenant schemas.
* v1 should focus on the API schema.

## Acceptance Criteria

* Dashboard displays tables and columns for a project.
* Works for v1 and v2.
* Shows helpful empty state for projects with no user tables.
* Shows RLS status if available.
* Uses the same backend inspection module as CLI commands.
* Does not expose secrets.

---

# Feature 3: Dashboard Data Explorer

## Summary

Add basic read-only row preview for project tables.

## Why it matters

A schema tells the user what the project can store.

A row preview tells the user what the project actually contains.

This is especially important for dormant projects. A user may not remember whether a project has real data, seed data, demo data, or nothing.

## Proposed UI

From the table list, clicking a table opens:

```text
photos

[Schema] [Rows]

Rows
────────────────────────────────────────────
id        title             created_at
abc...    Sidewalk Flare    2026-06-15
def...    Roll 001 Frame    2026-06-16
```

Default behavior:

* limit 50 rows
* read-only
* no editing
* no deletes
* no arbitrary filters at first

Optional early filters:

* search within visible results
* sort by common columns
* pagination
* copy row JSON

## Constraints

* Read-only.
* Limit rows.
* Prevent expensive full-table scans where possible.
* Respect RLS/security model.
* Avoid becoming a full database admin panel.
* Avoid complex filtering in v1.

## Acceptance Criteria

* User can preview rows from a table.
* Large tables do not load unbounded data.
* Empty tables show a useful empty state.
* Sensitive values are not specially solved in v1, but the interface should avoid encouraging careless sharing.
* Works in both active and dormant projects if the dormant project can be inspected without activating public runtime.

## Product Boundary

This is not intended to replace Beekeeper, DBeaver, TablePlus, or `psql`.

It exists so the user can answer:

> What data does this project have?

---

# Feature 4: Project Doctor

## Summary

Add a first-class health check command and dashboard equivalent.

## Why it matters

A user often needs one answer:

> Is this project okay?

Today, that answer may require checking multiple surfaces:

* project exists
* mode
* DB reachable
* API reachable
* migrations ledger
* backup state
* credentials
* tunnel path
* PostgREST/gateway
* RLS/grants

Flux should gather this into one command.

## Proposed Commands

```bash
flux doctor
flux project doctor <project> --hash <hash>
```

## Expected Output

```text
Flux Doctor: noisydesign

PASS  Control plane reachable
PASS  Project found
PASS  Mode: v2_shared
PASS  Tenant schema exists
PASS  Database reachable
PASS  API reachable
PASS  Migration ledger readable
WARN  Latest backup is not restore-verified
PASS  Read-only DB access available

Result:
Project is usable, but latest backup should be verified.
```

## Dashboard Version

Project overview card:

```text
Health

Usable with warnings

✓ API reachable
✓ Database reachable
✓ Schema found
! Latest backup not verified
```

## Constraints

* Must avoid destructive checks.
* Must not require public DB exposure.
* Must not leak secrets.
* Must distinguish hard failures from warnings.
* Must provide next-step remediation.

## Acceptance Criteria

* Doctor exits non-zero only on hard failures.
* Warnings are clear and actionable.
* Works for v1 and v2.
* Can detect obvious project misconfiguration.
* Can be used as a smoke test in development and production.

---

# Feature 5: Backup Visibility and Trust UX

## Summary

Make backup state visible wherever the user might make risky decisions.

## Why it matters

Flux already has backup creation, verification, restore trust, and destructive gates. The next step is making that state obvious.

A user should not discover backup trust only when an operation fails.

## Desired Product Behavior

Every project should clearly show:

```text
Backup Status

Latest backup:
2026-06-21 14:22

Verification:
Restore-verified

Safe destructive actions:
Allowed
```

Or:

```text
Backup Status

Latest backup:
2026-06-21 14:22

Verification:
Not restore-verified

Safe destructive actions:
Blocked until verification

Action:
Verify latest backup
```

## Surfaces

Backup trust should appear in:

* project overview
* database tools section
* delete modal
* factory reset modal
* migration/dangerous operation flows
* CLI doctor
* CLI backup list
* dashboard project list, subtly

## Key UX Principle

Do not scare the user.

Use backup status as confidence, not punishment.

Bad:

> Destructive action forbidden.

Good:

> Latest backup has not been restore-verified. Verify it first so this project has a recovery path.

## Acceptance Criteria

* User can identify latest backup trust at a glance.
* Destructive buttons explain why they are blocked.
* CLI and dashboard language match.
* Backup verification path is one click or one obvious command.
* v1 and v2 labels are clear.
* Tenant export vs full DB backup is explained where relevant.

---

# Feature 6: Migration Plan and Diff Visibility

## Summary

Improve `flux push --plan` and dashboard migration visibility so users understand what is about to change.

## Why it matters

Migrations are where confidence is either built or destroyed.

A maker needs to know:

* what migrations are pending
* which tables are affected
* whether anything destructive appears
* what has already run
* what changed recently

Flux should not require users to manually read every SQL file to understand the plan.

## CLI Experience

```bash
flux push migrations/ --plan
```

Expected output:

```text
Pending migrations: 3

0017_create_issues.sql
Creates:
- issues
- issue_photos

0018_add_photo_visibility.sql
Alters:
- photos.visibility
- photos.published_at

0019_drop_legacy_tags.sql
Warning:
- contains DROP TABLE legacy_tags

No SQL has been applied.
```

## Dashboard Experience

Project page:

```text
Migrations

Applied
0016_photo_tags
0015_process_notes

Pending
0017_create_issues
0018_add_photo_visibility

Warnings
0019 contains DROP
```

## Scope

This does not need to be a perfect SQL compiler.

Early implementation can classify common DDL patterns:

* CREATE TABLE
* ALTER TABLE
* DROP TABLE
* CREATE INDEX
* DROP COLUMN
* ADD COLUMN
* CREATE POLICY
* ALTER POLICY
* ENABLE RLS
* DISABLE RLS

## Constraints

* Dry-run must remain safe.
* Never claim certainty beyond what is parsed.
* Clearly label heuristic analysis.
* Should integrate with existing migration ledger.
* v2 ledger must remain tenant-scoped.

## Acceptance Criteria

* User can see pending migration names before applying.
* User can see obvious table-level changes.
* Dangerous operations are highlighted.
* The system never applies SQL during plan mode.
* Existing migration flow remains compatible.

---

# Feature 7: Project Activity Timeline

## Summary

Add a durable project timeline showing important events.

## Why it matters

GitHub’s history is one of its strongest features.

Flux needs an equivalent for application infrastructure.

A user returning after months should be able to answer:

> What happened here?

## Timeline Events

Possible events:

* project created
* project activated
* project paused
* project archived
* migration applied
* backup created
* backup verified
* restore performed
* DB tunnel opened
* temporary credentials issued
* env var changed
* API health changed
* custom domain added
* project upgraded
* project migrated v2 to v1
* project deleted / scheduled for deletion
* first API request
* traffic threshold reached

## UI Example

```text
Activity

Today
✓ Backup verified

June 20
✓ DB tunnel opened
✓ Migration 0017_create_issues applied

June 15
✓ Project created
✓ First API request
```

## CLI Example

```bash
flux project activity noisydesign --hash <hash>
```

## Constraints

* Do not log secrets.
* Do not log raw SQL contents by default.
* Keep events concise.
* Store enough metadata to power future summaries.
* Avoid overwhelming the user with noisy request logs.

## Acceptance Criteria

* Important project lifecycle actions create timeline events.
* Timeline is visible in dashboard.
* CLI can print recent activity.
* Events are useful for reorientation.
* Sensitive data is redacted.

---

# Feature 8: Active / Dormant Lifecycle

## Summary

Introduce a product-level project lifecycle that reflects resource usage and maker behavior.

## Why it matters

Flux’s long-term pricing and identity depend on separating project existence from active runtime consumption.

A user may have dozens of projects. Most should not need to be active all the time.

## Proposed States

```text
Active
Dormant
Archived
```

### Active

The project is awake.

* API available
* runtime resources allocated
* normal traffic allowed
* backups scheduled according to plan
* counts toward active project limit

### Dormant

The project exists but is not actively serving normal traffic.

* data/schema retained
* project visible
* inspection still available if technically feasible
* public runtime paused or heavily limited
* does not count toward active project limit
* can be reactivated

### Archived

The project is intentionally frozen.

* not serving traffic
* preserved primarily as export/backup
* may require restore/wake flow
* used for old experiments or finished artifacts

## UX Language

Prefer calm language.

Good:

```text
Wake project
Put project to sleep
Archive project
```

Possibly too playful:

```text
Dreaming
Incubating
```

Prefer direct product terms:

```text
Active
Dormant
Archived
```

## Dashboard Model

```text
Projects

Active 3 / 3
Dormant 27
Archived 4
```

Project list:

```text
NoisyDesign        Active
MailPilot          Active
YeastCoast         Active
Habitat Ledger     Dormant
Spanish App        Dormant
PseudoChannel      Dormant
```

## Pricing Alignment

This supports the future free-tier idea:

```text
Unlimited projects
3 active projects
Dormant projects preserved
Upgrade for more active projects or more traffic
```

The product should not feel like it punishes experimentation.

It should feel like it charges when projects actually need runtime resources.

## Constraints

* Must be technically honest.
* Dormant cannot secretly consume expensive runtime.
* Must not break backups.
* Must not lose data.
* Must clearly explain what remains available while dormant.
* Must be reversible.

## Acceptance Criteria

* User can see which projects are active/dormant.
* User can wake a dormant project.
* User can put an active project to sleep.
* Active project limits are understandable.
* Dormant projects remain inspectable or clearly explain why they must be woken for certain actions.
* No data loss occurs during sleep/wake transitions.

---

# Feature 9: Project Overview / Portfolio Dashboard

## Summary

Reshape the dashboard around projects as durable assets.

## Why it matters

The UI does not need to become playful or heavily emotive. The project list itself should carry the new identity.

The user should feel:

> These are my application projects.

Not:

> These are database containers.

## Proposed Dashboard

```text
Projects

Active
────────────────────────────────────────
NoisyDesign
Photography publishing platform
12 tables · 3 backups · updated today

MailPilot
Gmail workflow tool
8 tables · backup verified · active this week

YeastCoast
Brewing tracker
6 tables · active today

Dormant
────────────────────────────────────────
Habitat Ledger
Home inventory and planning
18 tables · last active 41 days ago

Spanish App
Language learning experiment
5 tables · last active 3 months ago
```

## Project Card Contents

Each project row/card should show:

* name
* short purpose
* lifecycle state
* mode: v2 shared / v1 dedicated
* table count
* latest backup trust
* last activity
* traffic hint if relevant
* primary action: Open / Wake / Inspect

## What Not To Do

Avoid:

* overly playful labels
* gamified dashboards
* neon “idea board” energy
* motivational copy
* excessive cards and charts
* social-network style UI

Flux should feel closer to GitHub than Discord.

Restrained, useful, durable.

## Acceptance Criteria

* Project list makes active/dormant model obvious.
* User can reorient quickly.
* Infrastructure details are visible but not overwhelming.
* Project state is more prominent than container state.
* The UI still feels serious enough for startups.

---

# Feature 10: FLUX.md Project Brief

## Summary

Introduce an optional repository-level project brief file.

Preferred name:

```text
FLUX.md
```

## Why it matters

A normal README explains the codebase.

A Flux project brief explains the application state.

This should not be a manual journal burden. In the AI era, Flux should assume the user will generate the first draft with Cursor, Codex, or another coding tool, then edit it.

## Purpose

`FLUX.md` should answer:

> If future-me wakes this project up in six months, what does he need to know in five minutes?

## Proposed Sections

```md
# Flux Project Brief

## Purpose

## Current Status

## Runtime

## Data Model

## Important Tables

## User Model

## API Surface

## Integrations

## Safe Operations

## Known Risks

## Next Steps

## Notes for Future Work
```

## Flux Behavior

When a user links a Git repo:

1. Flux checks for `FLUX.md`.
2. If found, Flux displays it in the project overview.
3. If missing, Flux offers a copyable “Generate FLUX.md” prompt for Cursor/Codex.
4. Later, Flux may generate or update the brief automatically.

## Missing State

```text
No FLUX.md found.

This project can still run normally.

A Flux project brief helps future-you understand the app, schema, and operating assumptions.

[Copy generation prompt]
```

## Important Boundary

Do not force users to write this manually.

This should feel like:

> Flux can help you preserve context.

Not:

> Flux requires homework.

## Acceptance Criteria

* Flux can detect whether a linked repo has `FLUX.md`.
* Dashboard can display the brief if present.
* Missing brief state is helpful but not blocking.
* User can copy a generation prompt.
* Brief is optional.
* Project remains fully usable without it.

---

## 6. AI Boundary

AI belongs in Flux only when it helps with project understanding.

Good AI use cases:

* generate `FLUX.md`
* explain schema
* summarize project timeline
* summarize traffic growth
* suggest next steps based on existing project context
* explain why a project health check failed

Bad early AI use cases:

* autonomous project manager
* general coding agent
* chat-first dashboard
* automatic schema rewriting
* automatic production changes
* vague “AI assistant” features without a specific job

The AI rule:

> AI should help the user understand and continue a project, not replace Flux’s core operating model.

## 7. Immediate Build Order

Recommended sequence:

1. DB Inspection CLI
2. Shared schema-inspection core module
3. Dashboard Schema Explorer
4. Dashboard Data Explorer
5. Project Doctor
6. Backup Visibility pass
7. Migration Plan/Diff visibility
8. Activity Timeline
9. Active/Dormant lifecycle
10. Project Overview / Portfolio Dashboard
11. `FLUX.md` project brief support
12. AI-assisted project brief generation

## 8. Finished Product Direction

Flux should eventually support this complete user story:

> I can create unlimited application projects without thinking about infrastructure too early.
>
> I can keep most of them dormant.
>
> I can inspect them later and remember what they were.
>
> I can wake the ones that matter.
>
> I can see whether they are healthy.
>
> I can trust their backups.
>
> I can grow a successful project from pooled infrastructure into a stronger tier or dedicated runtime.
>
> I can leave whenever I want because export is clear, but I probably stay because Flux has become the home for my application projects.

## 9. Product Positioning Draft

Possible concise positioning:

> Flux is a PostgreSQL project platform for makers.
>
> Create many projects. Keep most dormant. Wake the ones that matter. Grow the ones that succeed.

Alternative:

> Flux is where application projects live before they become businesses.

Alternative:

> Build freely. Wake what matters. Scale what works.

## 10. Guiding Question

For every feature, ask:

> Does this help a user create, understand, trust, pause, revive, or grow a PostgreSQL-backed application project?

If yes, it likely belongs in Flux.

If no, it may be a distraction.
