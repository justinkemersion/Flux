import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { env } from "./env.ts";

const app = createApp();

const server = serve(
  {
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port: env.PORT,
  },
  (info) => {
    console.log(
      JSON.stringify({
        event: "gateway_started",
        port: info.port,
        baseDomain: env.FLUX_BASE_DOMAIN,
        postgrestPool: env.FLUX_POSTGREST_POOL_URL,
        redis: !!env.REDIS_URL,
      }),
    );
  },
);

// Keep socket timeout above upstream timeout so gateway does not cut requests early.
server.setTimeout(env.FLUX_GATEWAY_SOCKET_TIMEOUT_MS);
