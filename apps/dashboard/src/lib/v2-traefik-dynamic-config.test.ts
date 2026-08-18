import assert from "node:assert/strict";
import test from "node:test";
import { renderV2TraefikDynamicConfig } from "./v2-traefik-dynamic-config";

test("renders deterministic exact-host TLS routers for pooled tenants", () => {
  const rendered = renderV2TraefikDynamicConfig(
    [
      { slug: "zebra", hash: "abcdef0" },
      { slug: "alpha-app", hash: "0123abc" },
    ],
    "VSL-BASE.COM",
  );
  const config = JSON.parse(rendered) as {
    http: {
      routers: Record<string, { rule: string; tls: { certResolver: string } }>;
      services: Record<string, unknown>;
    };
  };

  assert.deepEqual(Object.keys(config.http.routers), [
    "flux-v2-tenant-0123abc",
    "flux-v2-tenant-abcdef0",
  ]);
  assert.equal(
    config.http.routers["flux-v2-tenant-0123abc"].rule,
    "Host(`api--alpha-app--0123abc.vsl-base.com`)",
  );
  assert.equal(
    config.http.routers["flux-v2-tenant-abcdef0"].tls.certResolver,
    "myresolver",
  );
  assert.ok(config.http.services["flux-v2-shared-gateway"]);
});

test("rejects catalog values that could alter a Traefik rule", () => {
  assert.throws(
    () =>
      renderV2TraefikDynamicConfig(
        [{ slug: "bad`) || Host(`evil", hash: "abcdef0" }],
        "vsl-base.com",
      ),
    /invalid slug/u,
  );
  assert.throws(
    () =>
      renderV2TraefikDynamicConfig(
        [{ slug: "safe", hash: "not-hash" }],
        "vsl-base.com",
      ),
    /invalid hash/u,
  );
  assert.throws(
    () => renderV2TraefikDynamicConfig([], "bad domain"),
    /invalid FLUX_DOMAIN/u,
  );
});
