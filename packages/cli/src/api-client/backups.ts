import type { ApiClientContext } from "./context";
import {
  parseJsonResponseBody,
  throwIfNotOkDescribeFailed,
} from "./json-response";
import {
  createBackupResponseSchema,
  listBackupsResponseSchema,
  verifyBackupResponseSchema,
  type ListProjectBackupsResult,
  type ProjectBackup,
  type VerifyBackupResult,
} from "./schemas";

export async function listProjectBackups(
  ctx: ApiClientContext,
  hash: string,
): Promise<ListProjectBackupsResult> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/backups`;
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI backups list: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  throwIfNotOkDescribeFailed(res, body, text);
  const parsed = listBackupsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("CLI backups list: response had unexpected shape.");
  }
  return {
    backups: parsed.data.backups,
    ...(parsed.data.backupVolumeAbsoluteRoot !== undefined
      ? { backupVolumeAbsoluteRoot: parsed.data.backupVolumeAbsoluteRoot }
      : {}),
    ...(parsed.data.reconciledAt !== undefined
      ? { reconciledAt: parsed.data.reconciledAt }
      : {}),
  };
}

export async function createProjectBackup(
  ctx: ApiClientContext,
  hash: string,
): Promise<ProjectBackup> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/backups`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI backup create: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  throwIfNotOkDescribeFailed(res, body, text);
  const parsed = createBackupResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("CLI backup create: response had unexpected shape.");
  }
  return parsed.data.backup;
}

export async function getProjectBackupStream(
  ctx: ApiClientContext,
  input: {
    hash: string;
    backupId: string;
  },
): Promise<ReadableStream<Uint8Array>> {
  const token = ctx.tokenOrThrow();
  const h = input.hash.trim().toLowerCase();
  const id = input.backupId.trim();
  const url =
    `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}` +
    `/backups/${encodeURIComponent(id)}/download`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = `Request failed (${String(res.status)})`;
    try {
      const errBody = JSON.parse(text) as { error?: unknown };
      if (typeof errBody.error === "string" && errBody.error.trim()) {
        msg = errBody.error;
      }
    } catch {
      if (text.trim()) msg = text.trim().slice(0, 500);
    }
    throw new Error(msg);
  }
  if (!res.body) {
    throw new Error("CLI backup download: empty response body.");
  }
  return res.body;
}

export async function verifyProjectBackup(
  ctx: ApiClientContext,
  input: {
    hash: string;
    backupId: string;
  },
): Promise<VerifyBackupResult> {
  const token = ctx.tokenOrThrow();
  const h = input.hash.trim().toLowerCase();
  const id = input.backupId.trim();
  const url =
    `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}` +
    `/backups/${encodeURIComponent(id)}/verify`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `CLI backup verify: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  throwIfNotOkDescribeFailed(res, body, text);
  const parsed = verifyBackupResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("CLI backup verify: response had unexpected shape.");
  }
  return parsed.data;
}

export async function getProjectDumpStream(
  ctx: ApiClientContext,
  input: {
    hash: string;
    schemaOnly?: boolean;
    dataOnly?: boolean;
    clean?: boolean;
    publicOnly?: boolean;
  },
): Promise<ReadableStream<Uint8Array>> {
  if (input.schemaOnly === true && input.dataOnly === true) {
    throw new Error("schema-only and data-only cannot both be enabled.");
  }
  const token = ctx.tokenOrThrow();
  const hash = input.hash.trim().toLowerCase();
  const u = new URL(`${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(hash)}/dump`);
  if (input.schemaOnly === true) u.searchParams.set("schemaOnly", "1");
  if (input.dataOnly === true) u.searchParams.set("dataOnly", "1");
  if (input.clean === true) u.searchParams.set("clean", "1");
  if (input.publicOnly === true) u.searchParams.set("publicOnly", "1");

  const res = await fetch(u, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = `Request failed (${String(res.status)})`;
    try {
      const j = JSON.parse(text) as { error?: unknown };
      if (typeof j.error === "string" && j.error.trim().length > 0) {
        msg = j.error;
      }
    } catch {
      if (text.trim().length > 0) msg = text.trim().slice(0, 500);
    }
    throw new Error(msg);
  }
  if (!res.body) {
    throw new Error("CLI dump: empty response body.");
  }
  return res.body;
}
