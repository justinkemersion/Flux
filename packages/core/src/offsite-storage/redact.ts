const SENSITIVE_ENV_PATTERN =
  /(?:secret|access[_-]?key|token|(?:^|_)key(?:_|$))/iu;

/** Redact credential-like substrings from operator-facing error text. */
export function redactSensitiveText(input: string): string {
  return input
    .replace(/[A-Za-z0-9+/=]{20,}/g, "[REDACTED]")
    .replace(
      /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
      "[REDACTED]",
    );
}

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_PATTERN.test(name);
}
