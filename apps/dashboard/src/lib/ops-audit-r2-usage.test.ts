import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "bin", "ops-audit", "r2-usage.mjs");

type EnvMap = Record<string, string | undefined>;

type UsageMod = {
  classifyR2Usage: (
    totalBytes: number,
    thresholds: { warnBytes: number; failBytes: number },
  ) => "ok" | "warn" | "fail";
  parseR2UsageThresholds: (env?: EnvMap) => {
    freeTierBytes: number;
    warnBytes: number;
    failBytes: number;
    freeTierGib: number;
  };
  formatR2UsageLine: (input: {
    totalBytes: number;
    objectCount: number;
    freeTierBytes: number;
    freeTierGib: number;
    bucketLabel?: string;
  }) => string;
  redactR2Text: (input: string) => string;
  parseExtraBuckets: (raw: string, primaryBucket: string) => string[];
  parseListObjectsV2Xml: (xml: string) => {
    objects: Array<{ key: string; bytes: number }>;
    bytes: number;
    isTruncated: boolean;
    nextContinuationToken?: string;
  };
  measureR2Usage: (
    env?: EnvMap,
    deps?: {
      listBucket?: (input: { bucket: string }) => Promise<{
        bucket: string;
        bytes: number;
        objects: number;
        truncatedAtCap: boolean;
        pages: number;
      }>;
    },
  ) => Promise<{
    status: string;
    line: string;
    notes: string[];
    buckets: Array<{ name: string; bytes: number; objects: number; result: string }>;
  }>;
  isAccessDeniedError: (err: unknown) => boolean;
  listR2BucketUsage: (input: {
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    fetchImpl?: typeof fetch;
    now?: Date;
  }) => Promise<{ bytes: number; objects: number; pages: number }>;
  signS3GetHeaders: (input: {
    url: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
    now?: Date;
  }) => { Authorization: string; "x-amz-date": string };
  parseDotEnvAllowlist: (contents: string) => Record<string, string>;
};

async function loadMod(): Promise<UsageMod> {
  return (await import(pathToFileURL(SCRIPT).href)) as UsageMod;
}

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

test("classifyR2Usage is ok well under 5 GiB, warn at 5, fail at 8", async () => {
  const { classifyR2Usage, parseR2UsageThresholds } = await loadMod();
  const t = parseR2UsageThresholds({});
  assert.equal(t.freeTierBytes, 10 * GIB);
  assert.equal(t.warnBytes, 5 * GIB);
  assert.equal(t.failBytes, 8 * GIB);
  assert.equal(classifyR2Usage(80 * MIB, t), "ok");
  assert.equal(classifyR2Usage(5 * GIB - 1, t), "ok");
  assert.equal(classifyR2Usage(5 * GIB, t), "warn");
  assert.equal(classifyR2Usage(8 * GIB - 1, t), "warn");
  assert.equal(classifyR2Usage(8 * GIB, t), "fail");
  assert.equal(classifyR2Usage(12 * GIB, t), "fail");
});

test("bytes env overrides GiB knobs", async () => {
  const { parseR2UsageThresholds, classifyR2Usage } = await loadMod();
  const t = parseR2UsageThresholds({
    FLUX_R2_USAGE_WARN_GIB: "1",
    FLUX_R2_USAGE_WARN_BYTES: "100",
    FLUX_R2_USAGE_FAIL_BYTES: "200",
    FLUX_R2_USAGE_FREE_TIER_BYTES: "1000",
  });
  assert.equal(t.warnBytes, 100);
  assert.equal(t.failBytes, 200);
  assert.equal(t.freeTierBytes, 1000);
  assert.equal(classifyR2Usage(100, t), "warn");
  assert.equal(classifyR2Usage(200, t), "fail");
});

test("format line matches ops-audit example for ~80 MiB / 10 GiB", async () => {
  const { formatR2UsageLine } = await loadMod();
  const line = formatR2UsageLine({
    totalBytes: 80 * MIB,
    objectCount: 90,
    freeTierBytes: 10 * GIB,
    freeTierGib: 10,
    bucketLabel: "vsl-base-flux-backups",
  });
  assert.equal(
    line,
    "R2 storage: 80.0 MiB / 10 GiB free-tier (0.8%) — 90 objects in vsl-base-flux-backups",
  );
});

test("redactR2Text hides account ids and long credential-like tokens", async () => {
  const { redactR2Text } = await loadMod();
  const out = redactR2Text(
    "https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com AKIAIOSFODNN7EXAMPLE supersecrettokenvalue12",
  );
  assert.match(out, /\/\/\[account\]\.r2\.cloudflarestorage\.com/);
  assert.doesNotMatch(out, /abcdef0123456789abcdef0123456789/);
  assert.doesNotMatch(out, /AKIAIOSFODNN7EXAMPLE/);
  assert.doesNotMatch(out, /supersecrettokenvalue12/);
});

test("parseExtraBuckets trims, dedupes, and skips the primary bucket", async () => {
  const { parseExtraBuckets } = await loadMod();
  assert.deepEqual(
    parseExtraBuckets(" vsl-base-flux-media , vsl-base-flux-backups, vsl-base-flux-media ", "vsl-base-flux-backups"),
    ["vsl-base-flux-media"],
  );
  assert.deepEqual(parseExtraBuckets("", "b"), []);
});

test("parseListObjectsV2Xml sums Size and reads continuation", async () => {
  const { parseListObjectsV2Xml } = await loadMod();
  const parsed = parseListObjectsV2Xml(`<?xml version="1.0"?>
<ListBucketResult>
  <Contents><Key>prod/a.dump</Key><Size>1048576</Size></Contents>
  <Contents><Key>prod/b.dump</Key><Size>2097152</Size></Contents>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>tok&amp;en</NextContinuationToken>
</ListBucketResult>`);
  assert.equal(parsed.bytes, 1048576 + 2097152);
  assert.equal(parsed.objects.length, 2);
  assert.equal(parsed.isTruncated, true);
  assert.equal(parsed.nextContinuationToken, "tok&en");
});

test("measureR2Usage skips when R2 is disabled or SKIP is set", async () => {
  const { measureR2Usage } = await loadMod();
  const disabled = await measureR2Usage({ FLUX_R2_BACKUPS_ENABLED: "false" });
  assert.equal(disabled.status, "skip");
  const skipped = await measureR2Usage({
    FLUX_R2_BACKUPS_ENABLED: "true",
    FLUX_R2_USAGE_SKIP: "1",
  });
  assert.equal(skipped.status, "skip");
});

test("measureR2Usage warns when enabled but credentials are incomplete", async () => {
  const { measureR2Usage } = await loadMod();
  const report = await measureR2Usage({
    FLUX_R2_BACKUPS_ENABLED: "true",
    FLUX_R2_BACKUP_BUCKET: "vsl-base-flux-backups",
  });
  assert.equal(report.status, "warn");
  assert.match(report.line, /incomplete/);
});

test("measureR2Usage fails at 8 GiB with mocked listing", async () => {
  const { measureR2Usage } = await loadMod();
  const report = await measureR2Usage(
    {
      FLUX_R2_BACKUPS_ENABLED: "true",
      FLUX_R2_BACKUP_BUCKET: "vsl-base-flux-backups",
      FLUX_R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      FLUX_R2_ACCESS_KEY_ID: "ak",
      FLUX_R2_SECRET_ACCESS_KEY: "sk",
    },
    {
      listBucket: async () => ({
        bucket: "vsl-base-flux-backups",
        bytes: 8 * GIB,
        objects: 12,
        truncatedAtCap: false,
        pages: 1,
      }),
    },
  );
  assert.equal(report.status, "fail");
  assert.match(report.line, /8\.0 GiB \/ 10 GiB free-tier \(80\.0%\)/);
});

test("measureR2Usage stays ok for ~80 MiB with mocked listing", async () => {
  const { measureR2Usage } = await loadMod();
  const report = await measureR2Usage(
    {
      FLUX_R2_BACKUPS_ENABLED: "true",
      FLUX_R2_BACKUP_BUCKET: "vsl-base-flux-backups",
      FLUX_R2_ENDPOINT: "https://abc123def456.r2.cloudflarestorage.com",
      FLUX_R2_ACCESS_KEY_ID: "test-access-key-id-value",
      FLUX_R2_SECRET_ACCESS_KEY: "test-secret-access-key-value",
    },
    {
      listBucket: async () => ({
        bucket: "vsl-base-flux-backups",
        bytes: 80 * MIB,
        objects: 90,
        truncatedAtCap: false,
        pages: 1,
      }),
    },
  );
  assert.equal(report.status, "ok");
  assert.match(report.line, /80\.0 MiB \/ 10 GiB free-tier \(0\.8%\)/);
  assert.equal(report.notes.length, 0);
  assert.doesNotMatch(report.line, /test-access-key-id-value/);
  assert.doesNotMatch(report.line, /abc123def456/);
});

test("extra-bucket AccessDenied is WARN not FAIL and does not invent totals", async () => {
  const { measureR2Usage, isAccessDeniedError } = await loadMod();
  const denied = new Error("AccessDenied");
  (denied as { status?: number; code?: string }).status = 403;
  (denied as { status?: number; code?: string }).code = "AccessDenied";
  assert.equal(isAccessDeniedError(denied), true);

  const report = await measureR2Usage(
    {
      FLUX_R2_BACKUPS_ENABLED: "true",
      FLUX_R2_BACKUP_BUCKET: "vsl-base-flux-backups",
      FLUX_R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      FLUX_R2_ACCESS_KEY_ID: "ak",
      FLUX_R2_SECRET_ACCESS_KEY: "sk",
      FLUX_R2_USAGE_EXTRA_BUCKETS: "vsl-base-flux-media,parcelpop-submissions-private",
    },
    {
      listBucket: async ({ bucket }) => {
        if (bucket === "vsl-base-flux-backups") {
          return {
            bucket,
            bytes: 80 * MIB,
            objects: 90,
            truncatedAtCap: false,
            pages: 1,
          };
        }
        throw denied;
      },
    },
  );
  assert.equal(report.status, "warn");
  assert.equal(report.buckets[0]?.bytes, 80 * MIB);
  assert.ok(report.notes.some((n) => /vsl-base-flux-media: AccessDenied/.test(n)));
  assert.ok(report.notes.some((n) => /parcelpop-submissions-private: AccessDenied/.test(n)));
  assert.equal(classifyWouldFail(report), false);
});

function classifyWouldFail(report: { status: string }): boolean {
  return report.status === "fail";
}

test("listR2BucketUsage paginates and sums via mocked fetch", async () => {
  const { listR2BucketUsage } = await loadMod();
  const pages = [
    `<?xml version="1.0"?><ListBucketResult>
      <Contents><Key>a</Key><Size>10</Size></Contents>
      <IsTruncated>true</IsTruncated>
      <NextContinuationToken>page2</NextContinuationToken>
    </ListBucketResult>`,
    `<?xml version="1.0"?><ListBucketResult>
      <Contents><Key>b</Key><Size>25</Size></Contents>
      <IsTruncated>false</IsTruncated>
    </ListBucketResult>`,
  ];
  let calls = 0;
  const usage = await listR2BucketUsage({
    bucket: "vsl-base-flux-backups",
    endpoint: "https://abc.r2.cloudflarestorage.com",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    fetchImpl: async (url, init) => {
      calls += 1;
      const href = String(url);
      assert.match(href, /list-type=2/);
      assert.doesNotMatch(href, /AKIA/);
      const headers = init?.headers as Record<string, string>;
      assert.match(headers.Authorization, /^AWS4-HMAC-SHA256 /);
      assert.doesNotMatch(JSON.stringify(headers), /wJalrXUtnFEMI/);
      const xml = pages.shift();
      assert.ok(xml);
      return new Response(xml, { status: 200 });
    },
    now: new Date("2026-09-15T00:00:00Z"),
  });
  assert.equal(calls, 2);
  assert.equal(usage.bytes, 35);
  assert.equal(usage.objects, 2);
  assert.equal(usage.pages, 2);
});

test("listR2BucketUsage maps HTTP 403 to AccessDenied", async () => {
  const { listR2BucketUsage, isAccessDeniedError } = await loadMod();
  await assert.rejects(
    () =>
      listR2BucketUsage({
        bucket: "vsl-base-flux-media",
        endpoint: "https://abc.r2.cloudflarestorage.com",
        accessKeyId: "ak",
        secretAccessKey: "sk",
        fetchImpl: async () =>
          new Response(`<Error><Code>AccessDenied</Code><Message>nope</Message></Error>`, {
            status: 403,
          }),
      }),
    (err: unknown) => isAccessDeniedError(err),
  );
});

test("signS3GetHeaders is stable for a frozen timestamp", async () => {
  const { signS3GetHeaders } = await loadMod();
  const headers = signS3GetHeaders({
    url: "https://abc.r2.cloudflarestorage.com/vsl-base-flux-backups?list-type=2",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "auto",
    now: new Date("2026-09-15T00:00:00Z"),
  });
  assert.equal(headers["x-amz-date"], "20260915T000000Z");
  assert.match(headers.Authorization, /Credential=AKIAIOSFODNN7EXAMPLE\/20260915\/auto\/s3\/aws4_request/);
  assert.equal(headers.Authorization.split("Signature=")[1]?.length, 64);
});

test("CLI --classify emits status=/line= without needing live R2", async () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--classify"],
    {
      input: JSON.stringify({
        totalBytes: 80 * MIB,
        objectCount: 90,
        bucketLabel: "vsl-base-flux-backups",
      }),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^status=ok$/m);
  assert.match(
    result.stdout,
    /line=R2 storage: 80\.0 MiB \/ 10 GiB free-tier \(0\.8%\) — 90 objects in vsl-base-flux-backups/,
  );
});

test("CLI --classify reports fail at 8 GiB", async () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--classify"],
    {
      input: JSON.stringify({ totalBytes: 8 * GIB, objectCount: 1, bucketLabel: "b" }),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^status=fail$/m);
});

test("parseDotEnvAllowlist ignores non-R2 secrets", async () => {
  const { parseDotEnvAllowlist } = await loadMod();
  const parsed = parseDotEnvAllowlist(`
# comment
FLUX_R2_BACKUPS_ENABLED=true
FLUX_R2_BACKUP_BUCKET=vsl-base-flux-backups
NEXTAUTH_SECRET=should-not-load
FLUX_R2_ACCESS_KEY_ID="ak"
`);
  assert.equal(parsed.FLUX_R2_BACKUPS_ENABLED, "true");
  assert.equal(parsed.FLUX_R2_ACCESS_KEY_ID, "ak");
  assert.equal(parsed.NEXTAUTH_SECRET, undefined);
});
