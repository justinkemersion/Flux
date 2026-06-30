import { and, eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import type { McpCapability } from "@/src/lib/mcp-capabilities";
import { isKnownMcpCapability } from "@/src/lib/mcp-capabilities";
import {
  authenticateControlPlaneBearer,
  type ControlPlaneAuth,
  isMcpControlPlaneAuth,
  type McpTokenAuthResult,
} from "@/src/lib/control-plane-auth";
import { extractBearerToken } from "@/src/lib/cli-api-auth";
import type { SystemDb } from "@/src/lib/db";

export type McpRouteCapability =
  | McpCapability
  /** Any valid MCP token — route still subject to project scope when applicable. */
  | "authenticated";

export type McpRouteClassification =
  | { kind: "forbidden" }
  | {
      kind: "allowed";
      capability: McpRouteCapability;
      projectScoped: boolean;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_HASH_RE = /^[a-f0-9]{7}$/u;

/** Normalize dynamic project hash segments for stable route matching. */
export function normalizeCliV1Path(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return trimmed.replace(/\/projects\/[a-f0-9]{7}(?=\/|$)/gi, "/projects/:hash");
}

type RouteRule = {
  pattern: RegExp;
  methods: readonly string[];
  capability: McpRouteCapability | "forbidden";
  projectScoped: boolean;
};

const MCP_CLI_ROUTE_RULES: readonly RouteRule[] = [
  {
    pattern: /^\/api\/cli\/v1\/auth\/verify$/,
    methods: ["GET"],
    capability: "authenticated",
    projectScoped: false,
  },
  {
    pattern: /^\/api\/cli\/v1\/list$/,
    methods: ["GET"],
    capability: "project:read",
    projectScoped: false,
  },
  {
    pattern: /^\/api\/cli\/v1\/audit$/,
    methods: ["POST"],
    capability: "authenticated",
    projectScoped: false,
  },
  {
    pattern: /^\/api\/cli\/v1\/intents$/,
    methods: ["GET"],
    capability: "intent:read",
    projectScoped: false,
  },
  {
    pattern: /^\/api\/cli\/v1\/intents$/,
    methods: ["POST"],
    capability: "authenticated",
    projectScoped: false,
  },
  {
    pattern: /^\/api\/cli\/v1\/intents\/[^/]+$/,
    methods: ["GET"],
    capability: "intent:read",
    projectScoped: false,
  },
  {
    pattern: /^\/api\/cli\/v1\/intents\/[^/]+$/,
    methods: ["PATCH"],
    capability: "authenticated",
    projectScoped: false,
  },
  {
    pattern: /^\/api\/cli\/v1\/push$/,
    methods: ["POST"],
    capability: "migration:apply",
    projectScoped: false,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash$/,
    methods: ["GET"],
    capability: "project:read",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/metadata$/,
    methods: ["GET"],
    capability: "project:read",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/lifecycle-state$/,
    methods: ["GET"],
    capability: "project:read",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/doctor$/,
    methods: ["POST"],
    capability: "project:read",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/schema-inspection$/,
    methods: ["POST"],
    capability: "schema:read",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/migrations$/,
    methods: ["GET"],
    capability: "schema:read",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/flux-md$/,
    methods: ["GET"],
    capability: "project:read",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/backups$/,
    methods: ["GET"],
    capability: "backup:read",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/backups$/,
    methods: ["POST"],
    capability: "backup:ensure_verified",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/backups\/[^/]+\/verify$/,
    methods: ["POST"],
    capability: "backup:ensure_verified",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/db-access$/,
    methods: ["GET"],
    capability: "query:readonly",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/db-access\/temporary-credential$/,
    methods: ["POST"],
    capability: "query:readonly",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/query$/,
    methods: ["POST"],
    capability: "query:readonly",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/activity$/,
    methods: ["GET"],
    capability: "activity:read",
    projectScoped: true,
  },
];

const MCP_FORBIDDEN_ROUTE_RULES: readonly RouteRule[] = [
  { pattern: /^\/api\/cli\/v1\/create$/, methods: ["POST"], capability: "forbidden", projectScoped: false },
  { pattern: /^\/api\/cli\/v1\/init$/, methods: ["POST"], capability: "forbidden", projectScoped: false },
  { pattern: /^\/api\/cli\/v1\/migrate$/, methods: ["POST"], capability: "forbidden", projectScoped: false },
  { pattern: /^\/api\/cli\/v1\/logs$/, methods: ["GET", "POST"], capability: "forbidden", projectScoped: false },
  { pattern: /^\/api\/cli\/v1\/codex$/, methods: ["GET", "POST"], capability: "forbidden", projectScoped: false },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash$/,
    methods: ["DELETE"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/lifecycle$/,
    methods: ["POST"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/lifecycle-state$/,
    methods: ["POST"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/metadata$/,
    methods: ["PATCH", "PUT"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/flux-md$/,
    methods: ["PUT", "PATCH"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/backups\/[^/]+\/download$/,
    methods: ["GET"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/dump$/,
    methods: ["POST", "GET"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/api-env$/,
    methods: ["GET"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/credentials$/,
    methods: ["GET", "POST"],
    capability: "forbidden",
    projectScoped: true,
  },
  {
    pattern: /^\/api\/cli\/v1\/projects\/:hash\/ai\/summary$/,
    methods: ["POST"],
    capability: "forbidden",
    projectScoped: true,
  },
];

function matchesRouteRule(
  rule: RouteRule,
  normalizedPath: string,
  method: string,
): boolean {
  if (!rule.methods.includes(method.toUpperCase())) return false;
  return rule.pattern.test(normalizedPath);
}

/** Classify an `/api/cli/v1/*` route for MCP token access. */
export function classifyMcpCliRoute(
  pathname: string,
  method: string,
): McpRouteClassification {
  const normalized = normalizeCliV1Path(pathname);
  const verb = method.toUpperCase();

  for (const rule of MCP_FORBIDDEN_ROUTE_RULES) {
    if (matchesRouteRule(rule, normalized, verb)) {
      return { kind: "forbidden" };
    }
  }

  for (const rule of MCP_CLI_ROUTE_RULES) {
    if (!matchesRouteRule(rule, normalized, verb)) continue;
    if (rule.capability === "forbidden") {
      return { kind: "forbidden" };
    }
    return {
      kind: "allowed",
      capability: rule.capability,
      projectScoped: rule.projectScoped,
    };
  }

  return { kind: "forbidden" };
}

export function assertMcpCapability(
  auth: McpTokenAuthResult,
  capability: McpCapability,
): { ok: true } | { ok: false; error: string } {
  if (!isKnownMcpCapability(capability)) {
    return { ok: false, error: "Unknown capability." };
  }
  if (!auth.capabilities.includes(capability)) {
    return {
      ok: false,
      error: `MCP token lacks required capability: ${capability}.`,
    };
  }
  return { ok: true };
}

export async function assertMcpProjectScope(
  db: SystemDb,
  auth: McpTokenAuthResult,
  projectHashOrId: string,
): Promise<
  | { ok: true; projectId: string; projectHash: string }
  | { ok: false; status: number; error: string }
> {
  const raw = projectHashOrId.trim();
  if (!raw) {
    return { ok: false, status: 400, error: "Project hash or id is required." };
  }

  const allowed = new Set(auth.projectIds);
  if (UUID_RE.test(raw)) {
    if (!allowed.has(raw)) {
      return {
        ok: false,
        status: 403,
        error: "Project is outside MCP token scope.",
      };
    }
    const [row] = await db
      .select({ id: projects.id, hash: projects.hash })
      .from(projects)
      .where(and(eq(projects.userId, auth.userId), eq(projects.id, raw)))
      .limit(1);
    if (!row) {
      return { ok: false, status: 404, error: "Project not found." };
    }
    return { ok: true, projectId: row.id, projectHash: row.hash };
  }

  const hash = raw.toLowerCase();
  if (!PROJECT_HASH_RE.test(hash)) {
    return {
      ok: false,
      status: 400,
      error: "projectHash must be a 7-char hex id.",
    };
  }

  const [row] = await db
    .select({ id: projects.id, hash: projects.hash })
    .from(projects)
    .where(and(eq(projects.userId, auth.userId), eq(projects.hash, hash)))
    .limit(1);
  if (!row) {
    return { ok: false, status: 404, error: "Project not found." };
  }
  if (!allowed.has(row.id)) {
    return {
      ok: false,
      status: 403,
      error: "Project is outside MCP token scope.",
    };
  }
  return { ok: true, projectId: row.id, projectHash: row.hash };
}

export async function enforceControlPlaneProjectScope(
  db: SystemDb,
  auth: ControlPlaneAuth,
  projectHash: string | null | undefined,
  projectId?: string | null | undefined,
): Promise<
  | { ok: true; projectId: string | null }
  | { ok: false; status: number; error: string }
> {
  if (!projectHash && !projectId) {
    return { ok: true, projectId: null };
  }

  if (projectHash) {
    const h = projectHash.trim().toLowerCase();
    if (!PROJECT_HASH_RE.test(h)) {
      return { ok: false, status: 400, error: "projectHash must be a 7-char hex id." };
    }
    if (isMcpControlPlaneAuth(auth)) {
      const scoped = await assertMcpProjectScope(db, auth, h);
      if (!scoped.ok) {
        return { ok: false, status: scoped.status, error: scoped.error };
      }
      return { ok: true, projectId: scoped.projectId };
    }
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, auth.userId), eq(projects.hash, h)))
      .limit(1);
    if (!row) {
      return { ok: false, status: 404, error: "Project not found." };
    }
    return { ok: true, projectId: row.id };
  }

  if (projectId) {
    if (isMcpControlPlaneAuth(auth)) {
      const scoped = await assertMcpProjectScope(db, auth, projectId);
      if (!scoped.ok) {
        return { ok: false, status: scoped.status, error: scoped.error };
      }
      return { ok: true, projectId: scoped.projectId };
    }
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, auth.userId), eq(projects.id, projectId)))
      .limit(1);
    if (!row) {
      return { ok: false, status: 404, error: "Project not found." };
    }
    return { ok: true, projectId: row.id };
  }

  return { ok: true, projectId: null };
}

export type CliRouteAuthInput = {
  pathname: string;
  method: string;
  projectHash?: string | null;
};

export type CliRouteAuthResult =
  | { ok: true; auth: ControlPlaneAuth }
  | { ok: false; status: number; error: string; code?: string };

export function cliRouteAuthJsonError(
  result: Extract<CliRouteAuthResult, { ok: false }>,
): Response {
  return Response.json(
    result.code ? { error: result.error, code: result.code } : { error: result.error },
    { status: result.status },
  );
}

/**
 * Authenticate a CLI/MCP Bearer request and enforce MCP route allowlist,
 * capability, and optional project scope.
 */
export async function authorizeCliRoute(
  db: SystemDb,
  bearerSecret: string | null | undefined,
  input: CliRouteAuthInput,
): Promise<CliRouteAuthResult> {
  const auth = await authenticateControlPlaneBearer(db, bearerSecret);
  if (!auth) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (!isMcpControlPlaneAuth(auth)) {
    return { ok: true, auth };
  }

  const route = classifyMcpCliRoute(input.pathname, input.method);
  if (route.kind === "forbidden") {
    return {
      ok: false,
      status: 403,
      error: "MCP tokens cannot access this route.",
      code: "mcp_token_route_forbidden",
    };
  }

  if (route.capability !== "authenticated") {
    const cap = assertMcpCapability(auth, route.capability);
    if (!cap.ok) {
      return { ok: false, status: 403, error: cap.error, code: "mcp_capability_denied" };
    }
  }

  if (route.projectScoped && input.projectHash) {
    const scoped = await assertMcpProjectScope(db, auth, input.projectHash);
    if (!scoped.ok) {
      return { ok: false, status: scoped.status, error: scoped.error };
    }
  }

  return { ok: true, auth };
}

/** Convenience wrapper for route handlers with a Request object. */
export async function authorizeCliHttpRequest(
  db: SystemDb,
  req: Request,
  input?: { projectHash?: string | null; method?: string },
): Promise<CliRouteAuthResult> {
  return authorizeCliRoute(db, extractBearerToken(req.headers.get("authorization")), {
    pathname: new URL(req.url).pathname,
    method: input?.method ?? req.method,
    projectHash: input?.projectHash,
  });
}

export function mcpTokenAllowsProjectId(
  auth: McpTokenAuthResult,
  projectId: string,
): boolean {
  return auth.projectIds.includes(projectId);
}
