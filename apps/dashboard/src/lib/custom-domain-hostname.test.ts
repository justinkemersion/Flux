import test from "node:test";
import assert from "node:assert/strict";
import {
  isFluxManagedPlatformHostname,
  validateCustomDomainHostname,
} from "./custom-domain-hostname";

test("isFluxManagedPlatformHostname matches canonical v2 flat API host", () => {
  process.env.FLUX_DOMAIN = "vsl-base.com";
  assert.equal(
    isFluxManagedPlatformHostname("api--demo--abc1234.vsl-base.com"),
    true,
  );
});

test("isFluxManagedPlatformHostname matches legacy dotted API host", () => {
  process.env.FLUX_DOMAIN = "vsl-base.com";
  assert.equal(
    isFluxManagedPlatformHostname("api.demo.abc1234.vsl-base.com"),
    true,
  );
});

test("validateCustomDomainHostname rejects platform hosts", () => {
  process.env.FLUX_DOMAIN = "vsl-base.com";
  const result = validateCustomDomainHostname(
    "api--victim--abc1234.vsl-base.com",
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Flux-managed platform hostnames/);
  }
});

test("validateCustomDomainHostname accepts unrelated custom host", () => {
  process.env.FLUX_DOMAIN = "vsl-base.com";
  const result = validateCustomDomainHostname("app.example.com");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.hostname, "app.example.com");
});
