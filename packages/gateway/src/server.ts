import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { env } from "./env.ts";

const app = createApp();

serve(
  {
    fetch: app.fetch,
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
