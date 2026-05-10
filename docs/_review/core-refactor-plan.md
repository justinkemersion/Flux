Chunked refactor: core/index.ts then CLI

What your three plans agree on





Goal: Same behavior, same public surface ([packages/core/package.json](packages/core/package.json) exports and index.ts re-exports), smaller files, ownership by reason to change — not a redesign (core-index-ts-extra.md).



Pattern: Keep ProjectManager as a facade; move work into operation modules; add FluxCoreContext so orchestration does not thread raw Docker/config everywhere (core-index-ts.md).



North star: README-aligned seams — v1_dedicated (Docker stack) vs v2_shared (schema/role/gateway/catalog) should not live as one deep if (mode) maze; route at the edge, separate deeper code over time (core-index-ts-readme-inclusion.md).



Order: Core first, CLI after — CLI becomes “parse → call @flux/core → format” once core modules exist (core-index-ts-extra.md).

Current anchor (repo reality)





[packages/core/src/index.ts](packages/core/src/index.ts) is ~3.6k lines; ProjectManager starts ~1637; many symbols are already re-exported from sibling files (tenant-catalog-urls, import-dump, api-schema-strategy, etc.).



Risk to preserve: Any move must keep package.json subpath exports (./standalone, ./api-schema-strategy, ./migration-status, ./backup-trust) and deep imports from those paths stable unless you intentionally version a breaking change.

Git / verification rhythm (your “chunks for problem solving”)

For each chunk below:





Branch or tag before the chunk (optional but useful: git tag refactor/core-before-phase-N).



One focused commit with a boring message (e.g. refactor(core): extract docker naming helpers).



Run: pnpm --filter @flux/core test (and any workspace script you already use for integration — dashboard/control-plane smoke if touched).



Stop if red: revert or fix in the same small surface before stacking the next extraction.

Avoid “refactor everything” mega-commits (core-index-ts-extra.md).

Dependency direction (avoid circular imports)

flowchart TD
  index[index.ts public exports]
  projects[projects orchestration]
  dockerMod[docker adapters]
  dbMod[database postgres]
  traefikMod[traefik labels]
  gatewayMod[gateway urls health]
  importsMod[imports supabase compat]
  backupsMod[backups trust]

  index --> projects
  projects --> dockerMod
  projects --> dbMod
  projects --> traefikMod
  projects --> gatewayMod
  projects --> importsMod
  projects --> backupsMod

Lower layers (docker-names, bootstrap-sql, label builders) must not import ProjectManager or provisioning orchestration (core-index-ts-extra.md).

Phase A — Pure / near-pure extractions (lowest risk)

Align with “first PR” in core-index-ts.md and checklist ordering in core-index-ts-readme-inclusion.md:





Constants + resource limits: FLUX_NETWORK_NAME, managed labels, FLUX_DOCKER_IMAGES, memory/CPU helpers → e.g. constants/ + docker/docker-resources.ts (names per your doc; keep folder count proportional to need).



Naming: fluxTenantStackBaseId, projectPrivateNetworkName, postgresContainerName, postgrestContainerName, tenantVolumeName, isPlatformSystemStackSlug → docker/docker-names.ts.



Bootstrap / PGRST schema env: buildBootstrapSql, BOOTSTRAP_SQL, pgrstDbSchemasEnvValue → database/bootstrap-sql.ts (or postgrest/postgrest-env.ts if you prefer README’s split — either is fine if ownership is clear).



Traefik / CORS: parseAllowedOriginsList, serializeAllowedOriginsList, postgrestTraefikDockerLabels, cert resolver helpers → traefik/*.



Docker client: createFluxDocker, SSH/remote options, assertFluxDockerEngineReachableOrThrow, formatDockerEngineTarget, resolveProjectManagerDocker → docker/docker-client.ts (+ docker-engine.ts if it stays readable).

[index.ts](packages/core/src/index.ts) should re-export these so consumers see no diff.

Tests (high value, per core-index-ts-extra.md): add focused tests beside the first extractions: naming, CORS serialization, bootstrap SQL shape, Traefik label keys — these guard contract drift, not syntax.

Phase B — Introduce FluxCoreContext without behavior change





Define FluxCoreContext in e.g. [packages/core/src/runtime/context.ts](packages/core/src/runtime/context.ts) (new file).



Mechanical pass: ProjectManager constructor builds ctx; methods delegate to local functions still in the same file first (no big behavior move yet). This isolates the next extractions from “method soup.”

Phase C — Move ProjectManager shell; keep methods delegating





Move the class to projects/project-manager.ts; leave method bodies calling through to functions still colocated or minimally moved — goal is “file ownership,” not logic rewrite (core-index-ts.md PR 2).

Phase D — Extract operations by capability (incremental)

Order by risk × clarity (your PR 3 emphasis: provisionProject first):





provisionProject → projects/provision-project.ts (may stay large; should read as a recipe with helpers — core-index-ts-extra.md).



Then lifecycle: stop/start/nuke, logs, reaper, listing, SQL execute/import, dumps, backups — one boring named file per capability; avoid utils.ts / services/ soup (core-index-ts-extra.md, core-index-ts.md).

v1 vs v2 seam (progressive): start with router at method edge (facade dispatches to provisionDedicated* / provisionShared* modules) rather than a single mega-function with deep branching (core-index-ts-readme-inclusion.md). Types can evolve toward CatalogProject vs DedicatedProjectRuntime vs SharedProjectRuntime as you touch each code path.

Explicit destructive ops: keep names like deleteProjectContainers / deleteProjectVolumes rather than vague cleanupProject (core-index-ts-extra.md).

Phase E — Slim index.ts to public contract only

Target shape from core-index-ts-extra.md: index.ts = re-exports + types the package promises; no implementation bodies.

Phase F — CLI: [packages/cli/src/index.ts](packages/cli/src/index.ts) (after core stabilizes)

Mirror the same philosophy (core-index-ts-readme-inclusion.md):





index.ts: program setup + registerXCommand(program) only.



commands/*.ts: parse options → ProjectManager / core → format output.



output/*, safety/* (confirm dangerous actions) as needed.

(You wrote packages/cli/sirc/index.ts; the repo path is packages/cli/src/index.ts.)

Documentation (optional, separate commit)





README opening paragraph: align “two runtime modes” wording with v1 vs v2 (core-index-ts-readme-inclusion.md). Keep this out of the first mechanical extractions so doc and code refactors do not mix in one blame layer.

What not to do (your constraints)





No inheritance tower on ProjectManager (core-index-ts.md).



No “compat shims” unless truly migration-temporary and labeled (core-index-ts-extra.md).



No premature interfaces everywhere — only at real swap/test boundaries.

Success criteria





Green tests after every chunk; git history shows reversible steps; public exports unchanged unless deliberately versioned.



Engineers can answer “where do I fix this?” using the room map: Docker / Traefik / database / projects / gateway / backups / CLI (core-index-ts-extra.md).

