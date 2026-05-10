@packages/core/src/index.ts

The main issue is that `index.ts` is doing five jobs:

1. public package exports
2. Docker/runtime configuration
3. Traefik label generation
4. Postgres/PostgREST provisioning
5. project lifecycle orchestration through `ProjectManager`

The biggest pressure point is this:

```ts
export class ProjectManager {
  ...
}
```

`ProjectManager` starts around the middle of the file and runs for roughly 2,000 lines. It currently owns provisioning, env mutation, CORS, JWT rotation, dumps, SQL execution, import/reset, project listing, idle reaping, logs, stop/start/nuke, private networks, gateway checks, resource limits, and container replacement.

That is the “God object” smell.

But I would **not** delete `ProjectManager`. I would turn it into a **facade**.

## The better pattern for this file

For Flux, I would use:

```txt
facade class
+
operation modules
+
pure builder modules
+
infrastructure adapters
```

Meaning:

```ts
const manager = new ProjectManager();
await manager.provisionProject(...);
```

can remain the public API.

But internally:

```ts
async provisionProject(...) {
  return provisionProject(this.ctx, ...);
}
```

Where `provisionProject` lives elsewhere.

Example:

```ts
// packages/core/src/projects/project-manager.ts

export class ProjectManager {
  private readonly ctx: FluxCoreContext;

  constructor(arg?: Docker | ProjectManagerConnectOptions) {
    const docker = resolveProjectManagerDocker(arg);
    this.ctx = createFluxCoreContext({ docker });
  }

  async provisionProject(
    name: string,
    options?: ProvisionOptions,
    hash?: string,
  ): Promise<FluxProject> {
    return provisionProject(this.ctx, name, options, hash);
  }

  async listProjects(): Promise<FluxProjectSummary[]> {
    return listProjects(this.ctx);
  }

  async stopProject(name: string, hash: string): Promise<void> {
    return stopProject(this.ctx, name, hash);
  }
}
```

Then your `index.ts` becomes a public contract file again:

```ts
export { ProjectManager } from "./projects/project-manager";
export type {
  FluxProject,
  ProvisionOptions,
  FluxProjectCredentials,
} from "./projects/project-types";

export {
  createFluxDocker,
  formatDockerEngineTarget,
  assertFluxDockerEngineReachableOrThrow,
} from "./docker/docker-client";

export {
  postgrestTraefikDockerLabels,
  parseAllowedOriginsList,
  serializeAllowedOriginsList,
} from "./traefik/labels";

export {
  buildBootstrapSql,
  BOOTSTRAP_SQL,
  pgrstDbSchemasEnvValue,
} from "./database/bootstrap-sql";
```

That is the modern TypeScript answer. Not more inheritance. Not C++-style class trees. Keep the useful class as a facade, but move the actual work into focused modules.

## Suggested folder split for this exact file

I would refactor toward something like this:

```txt
packages/core/src/
  index.ts

  projects/
    project-manager.ts
    project-types.ts
    provision-project.ts
    project-env.ts
    project-credentials.ts
    project-dumps.ts
    project-sql.ts
    project-import.ts
    project-listing.ts
    project-lifecycle.ts
    project-reaper.ts
    project-logs.ts

  docker/
    docker-client.ts
    docker-engine.ts
    docker-env.ts
    docker-labels.ts
    docker-images.ts
    docker-pull.ts
    docker-network.ts
    docker-containers.ts
    docker-resources.ts
    docker-names.ts

  traefik/
    traefik-labels.ts
    cors-origins.ts
    host-rules.ts

  database/
    bootstrap-sql.ts
    postgres-uri.ts
    tenant-passwords.ts
    dump-stream.ts
    execute-sql.ts

  runtime/
    context.ts
    config.ts
    errors.ts

  constants/
    labels.ts
    images.ts
    network.ts
```

The key is that this is **not** just “split by file size.” It is split by reason-to-change.

For example:

```txt
traefik/traefik-labels.ts
```

changes when routing/CORS/TLS rules change.

```txt
database/bootstrap-sql.ts
```

changes when tenant DB bootstrap changes.

```txt
projects/provision-project.ts
```

changes when the project creation workflow changes.

```txt
docker/docker-client.ts
```

changes when Docker connection behavior changes.

That is the real win.

## First extraction candidates

I would start with the low-risk stuff first.

### 1. Move constants and pure builders

These are good first targets:

```ts
FLUX_NETWORK_NAME
FLUX_MANAGED_LABEL
FLUX_DOCKER_IMAGES
FLUX_GATEWAY_CONTAINER_NAME
fluxTenantMemoryLimitBytes()
fluxTenantCpuNanoCpus()
tenantStackHostMemoryConfig()
buildBootstrapSql()
BOOTSTRAP_SQL
pgrstDbSchemasEnvValue()
postgrestTraefikDockerLabels()
parseAllowedOriginsList()
serializeAllowedOriginsList()
```

These are mostly pure or near-pure. Extracting them should not change behavior.

Possible destination:

```txt
docker/docker-resources.ts
database/bootstrap-sql.ts
traefik/traefik-labels.ts
traefik/cors-origins.ts
constants/docker-labels.ts
constants/docker-images.ts
```

### 2. Move Docker connection logic

This section should become its own module:

```ts
ProjectManagerConnectOptions
assertNoRemoteFieldsWithoutHost()
defaultSshAgentOptions()
expandUserPath()
maybeAutoSshPrivateKeyFileOption()
mergeSshOptionsForSshProtocol()
applySshEngineKeepalives()
augmentDockerSshClientIfNeeded()
createFluxDocker()
formatDockerEngineTarget()
dockerEngineRequiresStrictReachability()
assertFluxDockerEngineReachableOrThrow()
resolveProjectManagerDocker()
```

Destination:

```txt
docker/docker-client.ts
docker/docker-engine.ts
```

This is a very clean boundary.

### 3. Move naming helpers

These belong together:

```ts
fluxTenantStackBaseId()
projectPrivateNetworkName()
postgresContainerName()
postgrestContainerName()
tenantVolumeName()
isPlatformSystemStackSlug()
```

Destination:

```txt
docker/docker-names.ts
```

This will also make future v2/v1 migration work cleaner because naming rules become explicit.

### 4. Split `ProjectManager` by capability

Inside `ProjectManager`, I would eventually break methods into operation modules:

```txt
projects/provision-project.ts
projects/project-env.ts
projects/project-dumps.ts
projects/project-sql.ts
projects/project-import.ts
projects/project-lifecycle.ts
projects/project-reaper.ts
projects/project-logs.ts
```

But keep this public class:

```ts
export class ProjectManager {
  async provisionProject(...) {
    return provisionProject(this.ctx, ...);
  }

  async executeSql(...) {
    return executeSql(this.ctx, ...);
  }

  async importSqlFile(...) {
    return importSqlFile(this.ctx, ...);
  }

  async stopProject(...) {
    return stopProject(this.ctx, ...);
  }
}
```

This avoids breaking the dashboard, CLI, tests, and SDK consumers.

## The important design object: `FluxCoreContext`

I would introduce one internal context object:

```ts
export type FluxCoreContext = {
  docker: Docker;
  images: typeof FLUX_DOCKER_IMAGES;
  networkName: string;
  postgresUser: string;
};
```

Maybe slightly richer later:

```ts
export type FluxCoreContext = {
  docker: Docker;
  config: FluxRuntimeConfig;
  log?: (message: string) => void;
};
```

Then operation modules avoid importing global state everywhere.

Example:

```ts
export async function stopProject(
  ctx: FluxCoreContext,
  name: string,
  hash: string,
): Promise<void> {
  const slug = slugifyProjectName(name);
  const apiName = postgrestContainerName(hash, slug);
  const dbName = postgresContainerName(hash, slug);

  await stopContainerOrThrow(ctx.docker, apiName);
  await stopContainerOrThrow(ctx.docker, dbName);
}
```

This is clean, testable, and still boring.

## For the CLI `index.ts`

The CLI should follow a similar rule:

```txt
CLI index = parse + dispatch only
```

Not business logic.

Ideal shape:

```txt
packages/cli/src/
  index.ts

  context.ts

  commands/
    create.ts
    push.ts
    list.ts
    keys.ts
    env.ts
    backup.ts
    restore.ts
    migrate.ts
    nuke.ts
    start.ts
    stop.ts

  output/
    format-project.ts
    format-env.ts
    format-errors.ts

  prompts/
    confirm-dangerous-action.ts
```

Then `index.ts` is mostly:

```ts
import { registerCreateCommand } from "./commands/create";
import { registerPushCommand } from "./commands/push";
import { registerListCommand } from "./commands/list";

const program = createProgram();

registerCreateCommand(program);
registerPushCommand(program);
registerListCommand(program);

await program.parseAsync(process.argv);
```

Each command owns one user action:

```ts
export function registerPushCommand(program: Command) {
  program
    .command("push <file>")
    .option("--project <slug>")
    .option("--hash <hash>")
    .action(async (file, options) => {
      const ctx = await createCliContext(options);
      await pushCommand(ctx, { file, ...options });
    });
}
```

And then:

```ts
export async function pushCommand(ctx: CliContext, input: PushInput) {
  const manager = ctx.projectManager;
  await manager.pushSqlFromCli(...);
}
```

The CLI should not know Docker details, Traefik labels, PostgREST env names, SQL bootstrap details, or tenant network rules.

## What I would not do

I would not jump to inheritance:

```ts
class DockerProjectManager extends ProjectManager {}
class TraefikProjectManager extends DockerProjectManager {}
```

That will make Flux worse.

I would also avoid a giant `services/` folder:

```txt
services/
  project-service.ts
  docker-service.ts
  user-service.ts
  util-service.ts
```

That usually recreates the same problem with vaguer names.

And I would avoid prematurely making everything an interface. Use interfaces only at boundaries that you actually test or swap:

```ts
ContainerRuntime
SqlExecutor
BackupStore
Logger
```

Not for every small function.

## My recommended first PR

I would make the first refactor deliberately boring:

```txt
PR 1: Extract pure core modules from packages/core/src/index.ts
```

Move only:

```txt
docker images/constants
resource limit helpers
container/volume/network naming helpers
bootstrap SQL builder
Traefik/CORS label builders
Docker env record helpers
```

Keep all public exports working through `index.ts`.

Do not rewrite `ProjectManager` yet.

After that, do:

```txt
PR 2: Move ProjectManager into projects/project-manager.ts
```

Still no behavior change.

Then:

```txt
PR 3: Extract provisionProject into projects/provision-project.ts
```

That is the big one. `provisionProject` is the method that most deserves to become its own operation module.

My guiding rule for Flux would be:

```txt
index.ts should describe what Flux exposes.
ProjectManager should describe what Flux can do.
Operation modules should contain how Flux does it.
Adapters should touch Docker/Postgres/filesystem reality.
```

That gives you modern TypeScript structure without losing the direct, gritty, systems-programming feel that makes Flux good.
