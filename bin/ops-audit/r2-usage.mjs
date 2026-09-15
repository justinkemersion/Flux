#!/usr/bin/env node
/**
 * Measure Cloudflare R2 storage against the Standard free-tier allowance.
 *
 * Used by `bin/ops-audit.sh`. No extra deps (Node 18+ `fetch` + `node:crypto`).
 * Does not delete objects, change STRICT mode, or print secrets.
 *
 * Cloudflare R2 Standard free tier (storage): 10 GB-month. This check compares
 * summed object bytes to 10 GiB (1024^3) so the operator line stays in binary units.
 *
 * Defaults (overridable via env):
 *   FLUX_R2_USAGE_FREE_TIER_GIB=10
 *   FLUX_R2_USAGE_WARN_GIB=5          # WARN at 50% of 10 GiB
 *   FLUX_R2_USAGE_FAIL_GIB=8          # FAIL at 80% of 10 GiB
 *   FLUX_R2_USAGE_EXTRA_BUCKETS=      # comma-separated extra bucket names
 *   FLUX_R2_USAGE_SKIP=1              # skip cleanly
 *
 * Bytes-form env vars (`FLUX_R2_USAGE_*_BYTES`) override the GiB form when set.
 *
 * Extra buckets: listed with the same FLUX_R2_* credentials. AccessDenied on an
 * extra bucket is a WARN note, not FAIL. Do not add buckets the token cannot read.
 *
 * Usage:
 *   node r2-usage.mjs                 # live ListObjectsV2 from FLUX_R2_* env
 *   node r2-usage.mjs --env-file PATH # load allowlisted FLUX_R2_* keys from dotenv
 *   node r2-usage.mjs --classify      # stdin JSON → status=/line=/note= report
 *
 * Quiet when well under the WARN bar (status=ok).
 */

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KIB = 1024;
export const MIB = 1024 * 1024;
export const GIB = 1024 * 1024 * 1024;

/** Cloudflare R2 Standard free-tier storage compared in binary GiB. */
export const DEFAULT_FREE_TIER_GIB = 10;
export const DEFAULT_WARN_GIB = 5;
export const DEFAULT_FAIL_GIB = 8;

export const MAX_LIST_PAGES = 1000;

const ENV_FILE_ALLOWLIST = new Set([
  "FLUX_R2_BACKUPS_ENABLED",
  "FLUX_R2_BACKUP_BUCKET",
  "FLUX_R2_BACKUP_PREFIX",
  "FLUX_R2_ENDPOINT",
  "FLUX_R2_REGION",
  "FLUX_R2_ACCESS_KEY_ID",
  "FLUX_R2_SECRET_ACCESS_KEY",
  "FLUX_R2_USAGE_SKIP",
  "FLUX_R2_USAGE_FREE_TIER_GIB",
  "FLUX_R2_USAGE_WARN_GIB",
  "FLUX_R2_USAGE_FAIL_GIB",
  "FLUX_R2_USAGE_FREE_TIER_BYTES",
  "FLUX_R2_USAGE_WARN_BYTES",
  "FLUX_R2_USAGE_FAIL_BYTES",
  "FLUX_R2_USAGE_EXTRA_BUCKETS",
]);

export function envTruthy(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function parsePositiveNumber(raw) {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function parseR2UsageThresholds(env = process.env) {
  const freeTierGib =
    parsePositiveNumber(env.FLUX_R2_USAGE_FREE_TIER_GIB) ?? DEFAULT_FREE_TIER_GIB;
  const warnGib = parsePositiveNumber(env.FLUX_R2_USAGE_WARN_GIB) ?? DEFAULT_WARN_GIB;
  const failGib = parsePositiveNumber(env.FLUX_R2_USAGE_FAIL_GIB) ?? DEFAULT_FAIL_GIB;
  return {
    freeTierBytes: parsePositiveNumber(env.FLUX_R2_USAGE_FREE_TIER_BYTES) ?? freeTierGib * GIB,
    warnBytes: parsePositiveNumber(env.FLUX_R2_USAGE_WARN_BYTES) ?? warnGib * GIB,
    failBytes: parsePositiveNumber(env.FLUX_R2_USAGE_FAIL_BYTES) ?? failGib * GIB,
    freeTierGib,
  };
}

export function parseExtraBuckets(raw, primaryBucket) {
  const primary = (primaryBucket ?? "").trim();
  const seen = new Set();
  const out = [];
  for (const part of String(raw ?? "").split(",")) {
    const name = part.trim();
    if (!name || name === primary || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function classifyR2Usage(totalBytes, thresholds) {
  const bytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
  if (bytes >= thresholds.failBytes) return "fail";
  if (bytes >= thresholds.warnBytes) return "warn";
  return "ok";
}

function trimFixed(n) {
  const rounded = n >= 10 ? n.toFixed(1) : n.toFixed(1);
  return rounded.replace(/\.0$/, ".0");
}

export function formatStorageSize(bytes) {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (n >= GIB) return `${trimFixed(n / GIB)} GiB`;
  if (n >= MIB) return `${trimFixed(n / MIB)} MiB`;
  if (n >= KIB) return `${trimFixed(n / KIB)} KiB`;
  return `${Math.round(n)} B`;
}

export function formatUsagePercent(bytes, freeTierBytes) {
  if (!Number.isFinite(freeTierBytes) || freeTierBytes <= 0) return "n/a";
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const pct = (n / freeTierBytes) * 100;
  if (n > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

export function formatR2UsageLine({
  totalBytes,
  objectCount,
  freeTierBytes,
  freeTierGib,
  bucketLabel,
}) {
  const used = formatStorageSize(totalBytes);
  const cap = `${freeTierGib} GiB`;
  const pct = formatUsagePercent(totalBytes, freeTierBytes);
  const objects = Number.isFinite(objectCount) ? objectCount : 0;
  const objectBit = `${objects} object${objects === 1 ? "" : "s"}`;
  const where = bucketLabel ? ` in ${bucketLabel}` : "";
  return `R2 storage: ${used} / ${cap} free-tier (${pct}) — ${objectBit}${where}`;
}

/** Redact Cloudflare account ids in R2 hostnames. Never log secrets. */
export function redactR2Text(input) {
  let s = String(input ?? "");
  s = s.replace(
    /https?:\/\/[a-z0-9]{8,}\.r2\.cloudflarestorage\.com/gi,
    (m) => m.replace(/\/\/[a-z0-9]+\./i, "//[account]."),
  );
  s = s.replace(/[A-Za-z0-9+/]{20,}/g, "[REDACTED]");
  s = s.replace(/(?:AKIA|ASIA)[0-9A-Z]{16}/g, "[REDACTED]");
  return s;
}

export function isAccessDeniedError(err) {
  if (err == null) return false;
  const status = typeof err === "object" && err !== null && "status" in err
    ? Number(err.status)
    : undefined;
  const code = typeof err === "object" && err !== null && "code" in err
    ? String(err.code ?? "")
    : "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    status === 403 ||
    /AccessDenied|AllAccessDisabled|UnauthorizedOperation|\b403\b/i.test(code) ||
    /AccessDenied|AllAccessDisabled|UnauthorizedOperation|\b403\b/i.test(msg)
  );
}

export function decodeXmlEntities(text) {
  return String(text ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseListObjectsV2Xml(xml) {
  const body = String(xml ?? "");
  const objects = [];
  for (const block of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const inner = block[1];
    const keyRaw = inner.match(/<Key>([^<]*)<\/Key>/)?.[1];
    const sizeRaw = inner.match(/<Size>(\d+)<\/Size>/)?.[1];
    if (!keyRaw) continue;
    objects.push({
      key: decodeXmlEntities(keyRaw),
      bytes: Number(sizeRaw ?? 0),
    });
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(body);
  const tokenRaw = body.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1];
  const errorCode = body.match(/<Code>([^<]*)<\/Code>/)?.[1];
  return {
    objects,
    bytes: objects.reduce((sum, o) => sum + (Number.isFinite(o.bytes) ? o.bytes : 0), 0),
    isTruncated: truncated,
    nextContinuationToken: tokenRaw ? decodeXmlEntities(tokenRaw) : undefined,
    errorCode: errorCode ? decodeXmlEntities(errorCode) : undefined,
  };
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function amzDate(now) {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function rfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function canonicalQueryString(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(String(params[k]))}`)
    .join("&");
}

export function signS3GetHeaders({
  method = "GET",
  url,
  accessKeyId,
  secretAccessKey,
  region = "auto",
  now = new Date(),
}) {
  const parsed = new URL(url);
  const { amzDate: xAmzDate, dateStamp } = amzDate(now);
  const payloadHash = sha256Hex("");
  const canonicalUri = parsed.pathname || "/";
  const query = {};
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  const canonicalQuery = canonicalQueryString(query);
  const host = parsed.host;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${xAmzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    xAmzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return {
    host,
    "x-amz-date": xAmzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function joinEndpoint(endpoint, bucket) {
  const base = String(endpoint).replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(bucket)}`;
}

export async function listR2BucketUsage({
  bucket,
  endpoint,
  region = "auto",
  accessKeyId,
  secretAccessKey,
  fetchImpl = globalThis.fetch,
  now,
  maxPages = MAX_LIST_PAGES,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available (need Node 18+)");
  }
  let continuationToken;
  let pages = 0;
  let bytes = 0;
  let objects = 0;
  let truncatedAtCap = false;
  do {
    pages += 1;
    if (pages > maxPages) {
      truncatedAtCap = true;
      break;
    }
    const query = { "list-type": "2" };
    if (continuationToken) query["continuation-token"] = continuationToken;
    const url = `${joinEndpoint(endpoint, bucket)}?${canonicalQueryString(query)}`;
    const headers = signS3GetHeaders({
      url,
      accessKeyId,
      secretAccessKey,
      region,
      now: now ?? new Date(),
    });
    const res = await fetchImpl(url, { method: "GET", headers });
    const xml = await res.text();
    if (!res.ok) {
      const parsed = parseListObjectsV2Xml(xml);
      const code = parsed.errorCode || `HTTP_${res.status}`;
      const err = new Error(`R2 ListObjectsV2 failed for bucket ${bucket}: ${code}`);
      err.status = res.status;
      err.code = code;
      throw err;
    }
    const parsed = parseListObjectsV2Xml(xml);
    bytes += parsed.bytes;
    objects += parsed.objects.length;
    continuationToken = parsed.isTruncated ? parsed.nextContinuationToken : undefined;
  } while (continuationToken);
  return { bucket, bytes, objects, truncatedAtCap, pages };
}

export function parseDotEnvAllowlist(contents, allowlist = ENV_FILE_ALLOWLIST) {
  const out = {};
  for (const rawLine of String(contents ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!allowlist.has(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnvFileIntoProcess(filePath, env = process.env) {
  const parsed = parseDotEnvAllowlist(readFileSync(filePath, "utf8"));
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] == null || env[k] === "") env[k] = v;
  }
}

function skipReport(reason) {
  return {
    status: "skip",
    line: reason,
    notes: [],
    buckets: [],
  };
}

export async function measureR2Usage(env = process.env, deps = {}) {
  if (envTruthy(env.FLUX_R2_USAGE_SKIP)) {
    return skipReport("R2 usage check skipped — FLUX_R2_USAGE_SKIP is set");
  }
  if (!envTruthy(env.FLUX_R2_BACKUPS_ENABLED)) {
    return skipReport("R2 usage check skipped — FLUX_R2_BACKUPS_ENABLED is not set");
  }
  const bucket = env.FLUX_R2_BACKUP_BUCKET?.trim();
  const endpoint = env.FLUX_R2_ENDPOINT?.trim();
  const accessKeyId = env.FLUX_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.FLUX_R2_SECRET_ACCESS_KEY?.trim();
  const region = env.FLUX_R2_REGION?.trim() || "auto";
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    return {
      status: "warn",
      line: "R2 backups enabled but FLUX_R2_* is incomplete — skip usage check",
      notes: [],
      buckets: [],
    };
  }

  const thresholds = parseR2UsageThresholds(env);
  const extras = parseExtraBuckets(env.FLUX_R2_USAGE_EXTRA_BUCKETS, bucket);
  const names = [bucket, ...extras];
  const listBucket = deps.listBucket ?? listR2BucketUsage;
  const buckets = [];
  const notes = [];
  let totalBytes = 0;
  let totalObjects = 0;
  let primaryDenied = false;
  let listedPrimary = false;

  for (const name of names) {
    const isPrimary = name === bucket;
    try {
      const usage = await listBucket({
        bucket: name,
        endpoint,
        region,
        accessKeyId,
        secretAccessKey,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
        maxPages: deps.maxPages,
      });
      buckets.push({
        name,
        bytes: usage.bytes,
        objects: usage.objects,
        result: usage.truncatedAtCap ? "truncated" : "ok",
      });
      totalBytes += usage.bytes;
      totalObjects += usage.objects;
      if (isPrimary) listedPrimary = true;
      if (usage.truncatedAtCap) {
        notes.push(
          `${name}: listing stopped after ${MAX_LIST_PAGES} pages — totals may be undercounted`,
        );
      }
    } catch (err) {
      const denied = isAccessDeniedError(err);
      const detail = redactR2Text(err instanceof Error ? err.message : String(err));
      buckets.push({
        name,
        bytes: 0,
        objects: 0,
        result: denied ? "access_denied" : "error",
      });
      if (isPrimary) {
        primaryDenied = denied;
        notes.push(
          denied
            ? `${name}: AccessDenied listing backup bucket — usage not measured`
            : `${name}: ${detail}`,
        );
      } else if (denied) {
        notes.push(`${name}: AccessDenied (not included in totals)`);
      } else {
        notes.push(`${name}: ${detail}`);
      }
    }
  }

  const bucketLabel =
    buckets.filter((b) => b.result === "ok" || b.result === "truncated").length > 1
      ? `${names.length} buckets`
      : bucket;

  const line = formatR2UsageLine({
    totalBytes,
    objectCount: totalObjects,
    freeTierBytes: thresholds.freeTierBytes,
    freeTierGib: thresholds.freeTierGib,
    bucketLabel: listedPrimary || totalObjects > 0 ? bucketLabel : bucket,
  });

  let status = classifyR2Usage(totalBytes, thresholds);
  const hasDeniedExtra = buckets.some((b) => b.name !== bucket && b.result === "access_denied");
  const hasOtherError = buckets.some((b) => b.result === "error");
  const hasTruncated = buckets.some((b) => b.result === "truncated");
  if (
    status === "ok" &&
    (hasDeniedExtra || primaryDenied || hasOtherError || !listedPrimary || hasTruncated)
  ) {
    status = "warn";
  }

  return { status, line, notes, buckets };
}

export function renderR2UsageReport(report) {
  const lines = [`status=${report.status}`, `line=${report.line}`];
  for (const note of report.notes) {
    lines.push(`note=${note}`);
  }
  for (const b of report.buckets) {
    lines.push(`bucket=${b.name} bytes=${b.bytes} objects=${b.objects} result=${b.result}`);
  }
  return `${lines.join("\n")}\n`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function printHelp() {
  const text = `Measure Cloudflare R2 object bytes vs the Standard free-tier 10 GiB storage allowance.

Default thresholds: WARN at 5 GiB (50%), FAIL at 8 GiB (80%). Quiet (status=ok) when under WARN.

Env:
  FLUX_R2_BACKUPS_ENABLED     required true to run (otherwise skip)
  FLUX_R2_BACKUP_BUCKET       primary bucket (whole bucket; prefix is not a filter)
  FLUX_R2_ENDPOINT            https://<account_id>.r2.cloudflarestorage.com
  FLUX_R2_ACCESS_KEY_ID / FLUX_R2_SECRET_ACCESS_KEY
  FLUX_R2_REGION              default auto
  FLUX_R2_USAGE_FREE_TIER_GIB default 10
  FLUX_R2_USAGE_WARN_GIB      default 5
  FLUX_R2_USAGE_FAIL_GIB      default 8
  FLUX_R2_USAGE_*_BYTES       optional byte overrides for the GiB knobs
  FLUX_R2_USAGE_EXTRA_BUCKETS comma-separated extra buckets (AccessDenied = WARN)
  FLUX_R2_USAGE_SKIP          1/true/yes to skip

Account ids in hostnames are redacted. Credentials are never printed.
`;
  process.stdout.write(text);
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    return 0;
  }
  const envFileIdx = argv.indexOf("--env-file");
  if (envFileIdx >= 0) {
    const filePath = argv[envFileIdx + 1];
    if (!filePath) {
      process.stderr.write("r2-usage: --env-file requires a path\n");
      return 2;
    }
    loadEnvFileIntoProcess(filePath, env);
  }
  if (argv.includes("--classify")) {
    const raw = await readStdin();
    const input = JSON.parse(raw || "{}");
    const thresholds = {
      ...parseR2UsageThresholds(env),
      ...(input.warnBytes != null ? { warnBytes: Number(input.warnBytes) } : {}),
      ...(input.failBytes != null ? { failBytes: Number(input.failBytes) } : {}),
      ...(input.freeTierBytes != null ? { freeTierBytes: Number(input.freeTierBytes) } : {}),
      ...(input.freeTierGib != null ? { freeTierGib: Number(input.freeTierGib) } : {}),
    };
    const totalBytes = Number(input.totalBytes ?? 0);
    const status = classifyR2Usage(totalBytes, thresholds);
    const line = formatR2UsageLine({
      totalBytes,
      objectCount: Number(input.objectCount ?? 0),
      freeTierBytes: thresholds.freeTierBytes,
      freeTierGib: thresholds.freeTierGib,
      bucketLabel: input.bucketLabel,
    });
    process.stdout.write(renderR2UsageReport({ status, line, notes: input.notes ?? [], buckets: [] }));
    return 0;
  }
  const report = await measureR2Usage(env);
  process.stdout.write(renderR2UsageReport(report));
  return 0;
}

function isCliMain() {
  const entry = process.argv[1];
  if (entry === "-") return true;
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isCliMain()) {
  runCli().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`${redactR2Text(err instanceof Error ? err.message : String(err))}\n`);
      process.stdout.write(
        renderR2UsageReport({
          status: "warn",
          line: "R2 usage check failed unexpectedly — see stderr (redacted)",
          notes: [],
          buckets: [],
        }),
      );
      process.exitCode = 0;
    },
  );
}
