#!/usr/bin/env node
/**
 * Mint a short-lived HS256 project JWT for gateway smoke (stdout only).
 * Requires FLUX_SMOKE_JWT_SECRET (set by mint-smoke-bearer.sh or caller).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(
  path.join(root, "packages", "gateway", "package.json"),
);
const { SignJWT } = require("jose");

const secret = process.env.FLUX_SMOKE_JWT_SECRET?.trim();
if (!secret) {
  console.error("error: FLUX_SMOKE_JWT_SECRET is required");
  process.exit(2);
}

const sub = process.env.FLUX_SMOKE_JWT_SUB?.trim() || "flux-e2e-smoke";
const role = process.env.FUX_SMOKE_JWT_ROLE?.trim() || "authenticated";
const ttl = process.env.FLUX_SMOKE_JWT_TTL?.trim() || "10m";

const token = await new SignJWT({ sub, role })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime(ttl)
  .sign(new TextEncoder().encode(secret));

process.stdout.write(token);
