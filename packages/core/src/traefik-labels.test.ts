import test from "node:test";
import assert from "node:assert/strict";
import { postgrestTraefikDockerLabels } from "./traefik/traefik-labels.ts";

test("postgrestTraefikDockerLabels Host rule includes flattened and legacy dotted hostnames", () => {
  const prev = process.env.FLUX_DOMAIN;
  process.env.FLUX_DOMAIN = "vsl-base.com";
  try {
    const labels = postgrestTraefikDockerLabels("yeastcoast", "ffca33f", false, []);
    const ruleKey = Object.keys(labels).find((k) => k.endsWith(".rule"));
    assert.ok(ruleKey, "Traefik router rule label must exist");
    const rule = labels[ruleKey!]!;
    assert.match(
      rule,
      /Host\(`api--yeastcoast--ffca33f\.vsl-base\.com`\)/,
      "rule must include flattened canonical host",
    );
    assert.match(
      rule,
      /Host\(`api\.yeastcoast\.ffca33f\.vsl-base\.com`\)/,
      "rule must include legacy dotted host",
    );
    assert.ok(
      rule.includes("||"),
      "rule must OR flattened and legacy hosts",
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_DOMAIN;
    else process.env.FLUX_DOMAIN = prev;
  }
});
