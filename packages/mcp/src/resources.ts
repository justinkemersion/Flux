/**
 * MCP passive resources for project context and bundled docs.
 */

import type { FluxToolClient } from "./tools";
import { loadBundledDocMarkdown, BUNDLED_DOC_URIS, docSlugFromUri } from "./docs-loader";
import { sanitizeBackupListForMcp } from "./tools/backup-sanitize";
import {
  assertMcpResourceCapabilityAllowed,
  parseFluxResourceUri,
  requiredCapabilityForResource,
} from "./resource-capability-guard";

export const FLUX_RESOURCE_TEMPLATES = [
  {
    uriTemplate: "flux://projects/{hash}",
    name: "flux-project",
    description: "Project metadata, lifecycle, and FLUX.md brief.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "flux://projects/{hash}/schema",
    name: "flux-project-schema",
    description: "Read-only schema inspection snapshot.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "flux://projects/{hash}/backups",
    name: "flux-project-backups",
    description: "Sanitized backup list and trust metadata.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "flux://projects/{hash}/activity",
    name: "flux-project-activity",
    description: "Recent project activity timeline.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "flux://projects/{hash}/doctor",
    name: "flux-project-doctor",
    description: "Project health doctor report.",
    mimeType: "application/json",
  },
] as const;

export const FLUX_STATIC_RESOURCES = [
  {
    uri: "flux://projects",
    name: "flux-projects",
    description: "Catalog of projects visible to the authenticated MCP token.",
    mimeType: "application/json",
  },
  ...BUNDLED_DOC_URIS.map((uri) => ({
    uri,
    name: uri.replace("flux://docs/", "flux-doc-").replace(/\//g, "-"),
    description: `Bundled Flux documentation (${uri.replace("flux://docs/", "")}).`,
    mimeType: "text/markdown" as const,
  })),
] as const;

export async function readFluxResource(
  uri: string,
  client: FluxToolClient,
): Promise<{ mimeType: string; text: string } | { error: string }> {
  const parsed = parseFluxResourceUri(uri);
  if (parsed.kind === "unknown") {
    return { error: `Unknown resource URI: ${uri}` };
  }

  const required = requiredCapabilityForResource(parsed);
  if (required) {
    const denial = await assertMcpResourceCapabilityAllowed(required, client, uri);
    if (denial) {
      return { error: denial };
    }
  }

  if (parsed.kind === "doc") {
    const body = await loadBundledDocMarkdown(parsed.slug);
    if (!body) {
      return { error: `Documentation not found: ${parsed.slug}` };
    }
    return { mimeType: "text/markdown", text: body };
  }

  if (parsed.kind === "projects") {
    const projects = await client.listProjects();
    return {
      mimeType: "application/json",
      text: JSON.stringify({ projects }, null, 2),
    };
  }

  const hash = parsed.kind === "project" ? parsed.hash : parsed.hash;

  if (parsed.kind === "project") {
    const [metadata, lifecycle, brief] = await Promise.all([
      client.getProjectMetadata(hash),
      client.getProjectLifecycleState(hash).catch(() => null),
      client.fetchProjectFluxMdDetail(hash).catch(() => null),
    ]);
    return {
      mimeType: "application/json",
      text: JSON.stringify({ metadata, lifecycle, brief }, null, 2),
    };
  }

  if (parsed.kind === "project_sub") {
    switch (parsed.sub) {
      case "schema": {
        const schema = await client.schemaInspectProject({ hash });
        return { mimeType: "application/json", text: JSON.stringify(schema, null, 2) };
      }
      case "backups": {
        const backups = await client.listProjectBackups(hash);
        const data = sanitizeBackupListForMcp(backups);
        return { mimeType: "application/json", text: JSON.stringify(data, null, 2) };
      }
      case "activity": {
        const activity = await client.fetchProjectActivity(hash);
        return { mimeType: "application/json", text: JSON.stringify(activity, null, 2) };
      }
      case "doctor": {
        const report = await client.runDoctor(hash);
        return { mimeType: "application/json", text: JSON.stringify(report, null, 2) };
      }
      default:
        return { error: `Unsupported project resource: ${uri}` };
    }
  }

  return { error: `Unsupported resource: ${uri}` };
}

export function isDocResourceUri(uri: string): boolean {
  return docSlugFromUri(uri) !== null;
}
