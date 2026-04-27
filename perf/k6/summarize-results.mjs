#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd(), "perf", "results");
const runDir = process.argv[2] ? resolve(process.argv[2]) : latestRunDir(root);

if (!runDir || !existsSync(runDir)) {
  console.error("[summarize-results] no results directory found");
  process.exit(1);
}

const summaryFiles = readdirSync(runDir)
  .filter((name) => name.endsWith(".summary.json"))
  .sort();

const lines = [];
lines.push("# k6 Matrix Summary");
lines.push("");
lines.push(`- Run directory: \`${runDir}\``);
lines.push(`- Generated at: ${new Date().toISOString()}`);
lines.push("");

if (summaryFiles.length === 0) {
  lines.push("No `*.summary.json` files were found for this run.");
  lines.push("");
  lines.push("This usually means the matrix run was blocked before scenarios executed.");
  writeFileSync(join(runDir, "summary.md"), `${lines.join("\n")}\n`, "utf8");
  console.log(`[summarize-results] wrote ${join(runDir, "summary.md")}`);
  process.exit(0);
}

lines.push("| Scenario | Requests | p95 (ms) | max (ms) | failed % | 429 % | 503 % | 504 % | other 5xx % |");
lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");

for (const file of summaryFiles) {
  const scenario = file.replace(".summary.json", "");
  const fullPath = join(runDir, file);
  const data = JSON.parse(readFileSync(fullPath, "utf8"));
  const metrics = data.metrics ?? {};

  const requests = metricCount(metrics.http_reqs);
  const p95 = metricPercentile(metrics.http_req_duration, "p(95)");
  const dur = metrics.http_req_duration;
  const dmax = metricPercentile(dur, "p(99)") || asNumber(dur?.max);
  const failedRate = percent(metricRate(metrics.http_req_failed));
  const r429 = percent(metricRate(metrics.status_429));
  const r503 = percent(metricRate(metrics.status_503));
  const r504 = percent(metricRate(metrics.status_504));
  const rOther5xx = percent(metricRate(metrics.status_other_5xx));

  lines.push(
    `| ${scenario} | ${fmtInt(requests)} | ${fmtFloat(p95)} | ${fmtFloat(dmax)} | ${fmtFloat(failedRate)} | ${fmtFloat(r429)} | ${fmtFloat(r503)} | ${fmtFloat(r504)} | ${fmtFloat(rOther5xx)} |`,
  );
}

lines.push("");
lines.push("## Notes");
lines.push("- Prioritize `other 5xx` regressions first; they indicate non-shedding failures.");
lines.push("- In overload runs, a healthy system sheds with `503` before tail-latency collapse.");

const out = join(runDir, "summary.md");
writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
console.log(`[summarize-results] wrote ${out}`);

function latestRunDir(resultsRoot) {
  if (!existsSync(resultsRoot)) return null;
  const dirs = readdirSync(resultsRoot)
    .map((name) => join(resultsRoot, name))
    .filter((abs) => statSafe(abs)?.isDirectory())
    .sort();
  return dirs.at(-1) ?? null;
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** k6 `--summary-export` uses flat fields; some tools emit nested `values`. */
function metricCount(m) {
  if (!m) return 0;
  return asNumber(m.values?.count ?? m.count);
}

function metricRate(m) {
  if (!m) return 0;
  return asNumber(m.values?.rate ?? m.rate ?? m.value);
}

function metricPercentile(m, key) {
  if (!m) return 0;
  return asNumber(m.values?.[key] ?? m[key]);
}

function percent(rate) {
  return rate * 100;
}

function fmtInt(value) {
  return Math.round(value).toLocaleString("en-US");
}

function fmtFloat(value) {
  return value.toFixed(2);
}
