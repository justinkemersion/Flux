/**
 * Default Workers AI chat model for Codex + project summaries.
 * `@cf/meta/llama-3-8b-instruct` was deprecated 2026-05-30.
 * Override per host with `FLUX_WORKERS_AI_MODEL`.
 */
export const DEFAULT_WORKERS_AI_CHAT_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fast" as const;

export function resolveWorkersAiChatModel(): string {
  const override = process.env.FLUX_WORKERS_AI_MODEL?.trim();
  return override || DEFAULT_WORKERS_AI_CHAT_MODEL;
}
