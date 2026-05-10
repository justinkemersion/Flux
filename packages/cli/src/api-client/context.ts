/** Minimal surface passed into domain modules (implemented by {@link ApiClient}). */
export type ApiClientContext = {
  readonly baseUrl: string;
  tokenOrThrow(): string;
};
