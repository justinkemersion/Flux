# docs/_contract/terminology.md

# Flux Terminology

This file defines canonical language for Flux documentation.

Use these terms consistently.

## Flux

Flux is a PostgreSQL + REST backend platform for building applications with SQL migrations, JWT-based authentication, row-level security, and managed project infrastructure.

Do not describe Flux as only:

- a database host
- a dashboard
- an ORM
- a Firebase clone
- a Supabase clone

## Project

A Flux project is the deployable backend unit.

A project includes:

- database surface
- REST API surface
- routing identity
- authentication configuration
- project secret material
- engine assignment

Do not use “project” interchangeably with only “database.”

## Engine

An engine is the infrastructure model used to run a project.

Canonical engines:

- `v1_dedicated`
- `v2_shared`

Use “engine” for the internal model.
Use “deployment model” when writing for users in conceptual pages.

The Flux **dashboard** surfaces deployment as **Pooled** (`v2_shared`) and **Dedicated** (`v1_dedicated`) so the UI does not read like a simple “v2 is newer” version ladder. APIs, CLI metadata, and the catalog still use the canonical enum strings.

## v1 Dedicated

`v1_dedicated` means a project runs on its own PostgreSQL and PostgREST stack.

Use for:

- stronger physical isolation
- dedicated resources
- regulated or high-value workloads
- projects that should not share database infrastructure

Avoid calling it simply “Pro” in technical docs.

## v2 Shared

`v2_shared` means projects share infrastructure while remaining isolated by schema, role, project secrets, and gateway behavior.

Use for:

- Free/Standard projects
- prototypes
- SaaS apps
- efficient pooled infrastructure

Do not imply v2 is less real. It is pooled, not fake.

## Service URL

The Service URL is the canonical public API URL for a Flux project.

It is the URL applications call.

Prefer:

> Service URL

Avoid:

- dev URL
- API URL, unless the page is specifically explaining REST endpoints
- PostgREST URL, unless discussing internals

## Gateway

The Flux Gateway is the request boundary between public application traffic and internal project infrastructure.

It verifies project-aware authentication and forwards trusted requests to the appropriate internal API layer.

Do not describe the gateway as a proxy only.

## Bridge JWT

A Bridge JWT is a short-lived internal JWT minted by Flux after validating an external project JWT.

It is used between the Gateway and PostgREST.

Do not expose Bridge JWTs as user-facing credentials.

## JWT Secret

Each Flux project has its own JWT secret.

The project JWT secret is used to verify application-issued tokens for that project.

Do not describe v2 as using one global shared JWT secret.

## Migration

A migration is a SQL file applied through Flux to change the project schema.

Migrations are the source of truth for application data structure.

Prefer:

> Push a migration.

Avoid:

> Edit your database in the dashboard.

## RLS

RLS means PostgreSQL row-level security.

Flux does not replace RLS. Flux makes RLS usable in project-backed API flows.

## Tenant

Use “tenant” carefully.

A tenant usually refers to the isolated runtime/database context for a Flux project, especially in v2 shared architecture.

For user-facing docs, prefer “project” unless discussing isolation internals.

## Schema

In v2 shared projects, schemas are part of the tenant isolation boundary.

Use schema names only when relevant.

Avoid making schema naming the first concept a new user encounters.

## No-Shim Policy

Flux should fix platform capability gaps at the Flux layer instead of requiring app-level hacks.

Use this phrase in philosophy or architecture pages, not as casual filler.