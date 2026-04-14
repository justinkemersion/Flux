import { getProjectManager } from "@/src/lib/flux";

export const runtime = "nodejs";

const DEFAULT_OWNER_ID = "default-user";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function GET(): Promise<Response> {
  const pm = getProjectManager();
  const list = await pm.listProjects();

  const enriched = await Promise.all(
    list.map(async (row) => {
      try {
        const postgresConnectionString =
          await pm.getPostgresHostConnectionString(row.slug);
        return {
          slug: row.slug,
          status: row.status,
          apiUrl: row.apiUrl,
          postgresConnectionString,
          ownerId: DEFAULT_OWNER_ID,
        };
      } catch {
        return {
          slug: row.slug,
          status: row.status,
          apiUrl: row.apiUrl,
          postgresConnectionString: null as string | null,
          ownerId: DEFAULT_OWNER_ID,
        };
      }
    }),
  );

  return Response.json({ projects: enriched });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("name" in body) ||
    typeof (body as { name: unknown }).name !== "string"
  ) {
    return jsonError('Expected JSON body with a string "name" field', 400);
  }

  const rawName = (body as { name: string }).name.trim();
  if (!rawName) {
    return jsonError("Project name is required", 400);
  }

  const pm = getProjectManager();

  try {
    const project = await pm.provisionProject(rawName);
    const postgresHostConnectionString =
      await pm.getPostgresHostConnectionString(project.name);

    return Response.json({
      ownerId: DEFAULT_OWNER_ID,
      project: {
        name: project.name,
        slug: project.slug,
        apiUrl: project.apiUrl,
        postgresHostConnectionString,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("already exists") ||
      message.includes("Invalid project name")
    ) {
      return jsonError(message, 409);
    }
    return jsonError(message, 500);
  }
}
