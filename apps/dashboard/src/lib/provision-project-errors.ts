import { TenantShortIdCollisionError } from "@flux/engine-v2";

export type ProvisionProjectHttpError = {
  status: number;
  message: string;
  code?: string;
  shortId?: string;
};

/** Map engine provisioning failures to stable dashboard/CLI HTTP responses. */
export function mapProvisionProjectError(err: unknown): ProvisionProjectHttpError {
  if (err instanceof TenantShortIdCollisionError) {
    return {
      status: 409,
      code: "tenant_short_id_collision",
      shortId: err.shortId,
      message:
        "This project's tenant ID collided with an existing pooled schema (extremely rare). " +
        "Retry create — a new project UUID will be generated automatically.",
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Invalid project name")) {
    return { status: 400, message };
  }

  return { status: 500, message };
}

export function provisionProjectErrorBody(
  mapped: ProvisionProjectHttpError,
): Record<string, string> {
  const body: Record<string, string> = { error: mapped.message };
  if (mapped.code) body.code = mapped.code;
  if (mapped.shortId) body.shortId = mapped.shortId;
  return body;
}
