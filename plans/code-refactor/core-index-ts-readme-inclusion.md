The big insight: **The README already contains the architecture map that the code should start reflecting.** It names the real Flux boundaries clearly:

```txt
control plane
data plane
v1_dedicated
v2_shared
Docker resources
Traefik routing
PostgREST schema/cache behavior
Supabase import path
dashboard mode split
backup/restore trust model
CLI commands
```

So yes: splitting `packages/core/src/index.ts` and the CLI `index.ts` is not just “cleanup.” It is making the repo structure match the product.

## Main thing I would change in the code architecture

The README makes one thing very clear:

**v1 dedicated and v2 shared are now different engines.**

So I would avoid letting one `ProjectManager` internally become a maze of:

```ts
if (mode === "v2_shared") {
  ...
} else {
  ...
}
```

Some branching is fine at the edge, but the deeper code should separate.

I would eventually aim for:

```txt
packages/core/src/
  index.ts

  projects/
    project-manager.ts
    project-types.ts
    mode-router.ts

  v1-dedicated/
    provision-dedicated-project.ts
    dedicated-project-lifecycle.ts
    dedicated-project-credentials.ts
    dedicated-project-env.ts
    dedicated-project-logs.ts
    dedicated-project-backups.ts

  v2-shared/
    provision-shared-project.ts
    shared-project-lifecycle.ts
    shared-project-health.ts
    shared-project-backups.ts
    shared-tenant-schema.ts
    shared-tenant-role.ts

  docker/
    docker-client.ts
    docker-names.ts
    docker-network.ts
    docker-containers.ts
    docker-resources.ts
    docker-pull.ts

  traefik/
    traefik-labels.ts
    cors-origins.ts
    host-rules.ts
    supabase-rest-prefix.ts

  postgres/
    postgres-uri.ts
    postgres-exec.ts
    postgres-dump.ts
    postgres-restore-verify.ts
    postgres-major-version.ts

  postgrest/
    postgrest-env.ts
    postgrest-reload.ts
    postgrest-jwt.ts
    postgrest-profiles.ts

  imports/
    plain-sql-dump.ts
    supabase-compat.ts
    public-to-api.ts
    rls-disable.ts
    grants.ts

  backups/
    backup-types.ts
    backup-create.ts
    backup-verify.ts
    backup-retention.ts

  gateway/
    api-url.ts
    gateway-health.ts
    host-resolution.ts

  runtime/
    config.ts
    context.ts
    errors.ts
    logging.ts
```

That may look like a lot of files, but the README already justifies every one of those folders.

## The core pattern I would use

I would keep the current public API as a facade:

```ts
export class ProjectManager {
  async provisionProject(...) {}
  async stopProject(...) {}
  async startProject(...) {}
  async nukeProject(...) {}
  async importSqlFile(...) {}
  async createBackup(...) {}
}
```

But internally, the manager should route to capability modules.

Something like:

```ts
export class ProjectManager {
  constructor(private readonly ctx: FluxCoreContext) {}

  async provisionProject(input: ProvisionProjectInput) {
    if (input.mode === "v2_shared") {
      return provisionSharedProject(this.ctx, input);
    }

    return provisionDedicatedProject(this.ctx, input);
  }

  async stopProject(input: StopProjectInput) {
    if (input.mode === "v2_shared") {
      return stopSharedProject(this.ctx, input);
    }

    return stopDedicatedProject(this.ctx, input);
  }
}
```

Long-term, this is cleaner than one massive `ProjectManager` knowing every operational detail of both worlds.

## One naming suggestion

I would avoid calling everything “project” internally once the mode matters.

Use more precise names:

```txt
Dedicated project = v1 Docker stack
Shared project = v2 tenant schema + role
Catalog project = row in flux-system.projects
```

That distinction matters because your README already says:

```txt
v1_dedicated = containers + volume + env + credentials
v2_shared = schema + role + gateway + catalog health
```

Those are not the same runtime object.

That might lead to types like:

```ts
type ProjectMode = "v1_dedicated" | "v2_shared";

type CatalogProject = {
  slug: string;
  hash: string;
  mode: ProjectMode | null;
};

type DedicatedProjectRuntime = {
  postgresContainerName: string;
  postgrestContainerName: string;
  privateNetworkName: string;
  volumeName: string;
};

type SharedProjectRuntime = {
  tenantId: string;
  shortId: string;
  schemaName: string;
  roleName: string;
};
```

This will make bugs easier to reason about.

## README-derived module boundaries

The README gives you these obvious extraction targets:

### `docker/`

From:

```txt
Docker resources
flux-network
flux-<hash>-<slug>-net
flux-gateway
flux-<hash>-<slug>-db
flux-<hash>-<slug>-api
```

This should become:

```txt
docker-names.ts
docker-network.ts
docker-containers.ts
docker-resources.ts
docker-client.ts
```

### `traefik/`

From:

```txt
CORS middleware
stripPrefix
Host rules
router labels
```

This should become:

```txt
traefik-labels.ts
cors-origins.ts
supabase-rest-prefix.ts
host-rules.ts
```

### `postgrest/`

From:

```txt
PGRST_DB_SCHEMAS
PGRST_JWT_SECRET
NOTIFY pgrst, 'reload schema'
SIGUSR1
Accept-Profile
Content-Profile
```

This deserves its own module:

```txt
postgrest-env.ts
postgrest-reload.ts
postgrest-jwt.ts
postgrest-profiles.ts
```

### `imports/`

From:

```txt
Supabase compatibility transforms
public → api
grants after import
optional RLS disable
sanitize dump
query Postgres major version
```

This should not live beside provisioning code.

```txt
imports/
  plain-sql-dump.ts
  supabase-compat.ts
  public-to-api.ts
  grants.ts
  rls-disable.ts
```

### `backups/`

From:

```txt
Backup trust model
artifact validation
restore verification
tenant export for v2_shared
```

This clearly wants its own folder.

```txt
backups/
  backup-create.ts
  backup-verify.ts
  backup-types.ts
  dedicated-backup.ts
  shared-tenant-export.ts
```

## CLI refactor follows the README almost exactly

Your CLI section is already the file map:

```txt
packages/cli/src/
  index.ts
  context.ts

  commands/
    create.ts
    push.ts
    db-reset.ts
    list.ts
    stop.ts
    start.ts
    nuke.ts
    supabase-rest-path.ts
    env.ts
    reap.ts
    backup.ts
    restore.ts

  output/
    project-table.ts
    credentials.ts
    errors.ts

  safety/
    confirm-dangerous-action.ts
```

The CLI `index.ts` should be boring:

```ts
registerCreateCommand(program);
registerPushCommand(program);
registerDbResetCommand(program);
registerListCommand(program);
registerStopCommand(program);
registerStartCommand(program);
registerNukeCommand(program);
registerEnvCommand(program);
registerBackupCommand(program);
registerReapCommand(program);
```

That is it.

The CLI command modules should parse options, call `@flux/core`, and format output. They should not know how Traefik labels or PostgREST reloads work.

## One README concern

The opening paragraph still describes Flux primarily as:

```txt
Each project is an isolated tenant bucket: a dedicated PostgreSQL container with durable storage and a PostgREST container
```

That is true for `v1_dedicated`, but no longer true for the whole product because `v2_shared` is now a real path.

I would eventually update the opening to something like:

```md
Flux is a slim Backend-as-a-Service / Database-as-a-Service platform with two runtime modes:

- `v1_dedicated`: each project gets its own PostgreSQL + PostgREST container pair.
- `v2_shared`: projects share a pooled Postgres/PostgREST data plane with schema + role isolation behind the Flux gateway.

The control plane provisions, tracks, and operates both modes through a common project catalog.
```

That would align the README with where the architecture actually is now.

## Strongest recommendation

Use the README as the refactor checklist.

Do not invent a separate architecture diagram and then try to force the code into it. Your README already says what Flux is.

I’d turn this into an internal refactor plan:

```txt
1. Extract constants, names, and pure builders.
2. Extract Docker client/network/container modules.
3. Extract Traefik label/CORS/rest-prefix modules.
4. Extract PostgREST env/reload/JWT modules.
5. Extract Supabase import modules.
6. Move ProjectManager into projects/project-manager.ts.
7. Split v1_dedicated operations from v2_shared operations.
8. Refactor CLI index.ts into command modules.
9. Add focused tests beside each extracted module.
```

The most important architectural seam is:

```txt
v1_dedicated = Docker stack operations
v2_shared = tenant schema/role/gateway/catalog operations
```

If the refactor preserves that distinction cleanly, Flux will become much easier to test, debug, document, and evolve.
