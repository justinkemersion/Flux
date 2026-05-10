**Do not turn the refactor into a redesign.**

For the first pass, the win is:

```txt
same behavior
same public exports
same tests passing
smaller files
clearer ownership
```

Refactor like you are moving furniture, not rebuilding the house.

## 1. Make `index.ts` sacred

Treat `packages/core/src/index.ts` as the **public contract**.

It should eventually feel like:

```ts
export { ProjectManager } from "./projects/project-manager";

export type {
  FluxProject,
  FluxProjectSummary,
  ProvisionOptions,
} from "./projects/project-types";

export {
  createFluxDocker,
  assertFluxDockerEngineReachableOrThrow,
} from "./docker/docker-client";

export {
  buildBootstrapSql,
  BOOTSTRAP_SQL,
} from "./database/bootstrap-sql";
```

It should not contain implementation.

This gives you freedom to reorganize internals without breaking dashboard/CLI consumers.

## 2. Watch for circular imports

This is the sneaky danger when splitting large TypeScript files.

Avoid this:

```txt
projects/ imports docker/
docker/ imports projects/
database/ imports projects/
projects/ imports database/
```

Better dependency direction:

```txt
index.ts
  -> projects/
      -> docker/
      -> database/
      -> traefik/
      -> gateway/
      -> shared/
```

Lower-level modules should not know about higher-level orchestration.

For example, `docker-names.ts` should not import `ProjectManager`.

## 3. Prefer “boring named modules” over abstract folders

Good:

```txt
docker-names.ts
docker-resources.ts
postgres-uri.ts
bootstrap-sql.ts
traefik-labels.ts
project-env.ts
project-dumps.ts
```

Bad:

```txt
utils.ts
core.ts
helpers.ts
service.ts
manager-utils.ts
common.ts
```

A file name should make the future bug hunt easier.

## 4. Keep orchestration files readable

Some files are allowed to be longer.

For example:

```txt
provision-project.ts
```

may naturally be 300–600 lines because provisioning is a real workflow.

That is okay.

The problem is not length alone. The problem is **mixed responsibility**.

A good orchestration file reads like a recipe:

```ts
validateProjectInput();
ensureFluxNetwork();
createPostgresContainer();
waitForPostgres();
bootstrapDatabase();
createPostgrestContainer();
ensureGatewayCanRouteProject();
returnProjectCredentials();
```

Each step can call a focused helper.

## 5. Add tests immediately around extracted pure logic

The first extracted modules should be easy to test:

```txt
docker-names.test.ts
traefik-labels.test.ts
cors-origins.test.ts
bootstrap-sql.test.ts
postgres-uri.test.ts
project-env.test.ts
```

These are high-value because they protect the weird edge cases:

```txt
slug/hash naming
flattened API URL labels
CORS serialization
tenant schema naming
PostgREST env generation
resource limits
```

For Flux, this matters because many bugs will not be “syntax bugs.” They will be contract drift bugs.

## 6. Introduce an internal context object

Eventually, most operation modules should receive one thing:

```ts
type FluxCoreContext = {
  docker: Docker;
  config: FluxCoreConfig;
};
```

Then functions look like:

```ts
export async function provisionProject(
  ctx: FluxCoreContext,
  input: ProvisionProjectInput,
): Promise<FluxProject> {
  ...
}
```

This is cleaner than passing Docker, image names, network names, env flags, and logger functions everywhere.

It also makes future testing much easier.

## 7. Avoid hiding dangerous operations behind cute abstractions

Flux has destructive commands:

```txt
nuke
delete
reset
restore
stop
prune
```

Those should remain very explicit.

I would rather see:

```ts
deleteProjectContainers(ctx, project);
deleteProjectVolumes(ctx, project);
deleteProjectNetwork(ctx, project);
```

than:

```ts
cleanupProject(ctx, project);
```

With infrastructure code, boring explicit names are safer.

## 8. Preserve your No-Shim policy in the refactor

This is important.

Do not add compatibility hacks just because splitting files exposes awkward seams.

For example, avoid:

```ts
legacyProvisionProjectCompat()
normalizeOldProjectShape()
temporaryApiUrlFix()
```

unless they are truly migration-only and clearly marked.

The refactor should make the real contracts clearer:

```txt
v1 dedicated
v2 shared
tenant schema
JWT secret
gateway bridge JWT
flattened SSL-safe API URL
```

## 9. Do the CLI after core, not before

The CLI is probably large because core is large.

Once `packages/core` is split, the CLI refactor becomes easier.

The ideal CLI shape is:

```txt
CLI parses user intent
Core performs Flux behavior
CLI formats output
```

So CLI command files should mostly do:

```ts
const input = parseOptions(options);
const result = await manager.importSqlFile(input);
printResult(result);
```

They should not know low-level Docker/PostgREST/Traefik details.

## 10. Make each refactor commit boring

I would use commits like:

```txt
refactor(core): extract docker naming helpers
refactor(core): extract bootstrap SQL builders
refactor(core): extract Traefik label builders
refactor(core): move ProjectManager into projects module
refactor(core): extract project SQL operations
refactor(cli): split push command module
```

Avoid giant commits called:

```txt
refactor everything
cleanup core
big split
```

Those are hard to review and hard to revert.

## My strongest advice

Start with this rule:

> Every extracted file must either reduce risk, improve testability, or clarify a real Flux boundary.

Not “because the file is long.”

For Flux, the best end state is not a trendy architecture. It is a codebase where, when something breaks, you immediately know which room of the machine to walk into:

```txt
Docker problem?      docker/
Routing problem?     traefik/
SQL problem?         database/
Lifecycle problem?   projects/
JWT problem?         gateway/
Backup problem?      backups/
CLI UX problem?      packages/cli/src/commands/
```

That is the real prize.
