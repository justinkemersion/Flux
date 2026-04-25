import pino from "pino";

/**
 * Module-scoped pino logger.
 *
 * pino writes to stdout asynchronously via a worker thread (pino.transport) or
 * its internal sonic-boom stream, keeping the event loop unblocked.  This
 * replaces console.log, which is synchronous-to-stdout inside a Docker pipe
 * and stalls the event loop at high throughput.
 *
 * Log level: respects LOG_LEVEL env var; defaults to "info" in production
 * and "debug" in development.
 */
const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: "flux-gateway" },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Keep object shape compatible with the structured log contract defined in app.ts
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export default logger;
