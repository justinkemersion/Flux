/**
 * User-visible Codex / inference messages (shared by server action and client UI;
 * keep free of server-only dependencies such as Redis).
 */

/** Streamed when hourly inference quota is exceeded; upstream AI is not called. */
export const CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE =
  "[SYS_ERR] INFERENCE_QUOTA_EXCEEDED. Tactical limit reached. Synchronize with the machine after cooldown.";
