#!/usr/bin/env node
/**
 * Flux Gateway Scorecard — turns k6 --summary-export JSON into a PASS/FAIL
 * decision plus tier deductions (see docs/gateway-load-testing.md).
 *
 * Usage:
 *   node perf/k6/score-run.mjs --summary perf/results/<run>/arch-truth.summary.json
 *   node perf/k6/score-run.mjs --summary a.json --baseline-summary b.json --overload-summary overload.json
 *   node perf/k6/score-run.mjs --summary x.json --out perf/results/<run>/scorecard.md --fail-below 80
 *
 * Exit codes: 0 pass, 1 Tier-0 hard fail, 2 score below --fail-below (Tier-0 passed)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = { summaries: [], baseline: null, overload: null, outPath: null, failBelow: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--summary" && argv[i + 1]) {
      out.summaries.push(resolve(argv[++i]));
    } else if (a === "--baseline-summary" && argv[i + 1]) {
      out.baseline = resolve(argv[++i]);
    } else if (a === "--overload-summary" && argv[i + 1]) {
      out.overload = resolve(argv[++i]);
    } else if (a === "--out" && argv[i + 1]) {
      out.outPath = resolve(argv[++i]);
    } else if (a === "--fail-below" && argv[i + 1]) {
      out.failBelow = Number(argv[++i]);
    } else if (a === "--json") {
      out.json = true;
    } else if (!a.startsWith("-")) {
      out.summaries.push(resolve(a));
    }
  }
  if (out.summaries.length === 0) {
    console.error("Usage: node perf/k6/score-run.mjs --summary <k6.summary.json> [--baseline-summary ...] [--overload-summary ...] [--out scorecard.md] [--fail-below 80]");
    process.exit(1);
  }
  return out;
}

function loadSummary(path) {
  if (!existsSync(path)) throw new Error(`missing summary: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function durationMetric(metrics) {
  return metrics.http_req_duration ?? metrics["http_req_duration{expected_response:true}"];
}

function metricRate(m) {
  if (!m) return 0;
  return Number(m.values?.rate ?? m.rate ?? m.value ?? 0);
}

function percentile(dur, key) {
  if (!dur) return 0;
  const v = dur[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function checksPassRate(metrics, root) {
  if (metrics.checks && typeof metrics.checks.value === "number") {
    return metrics.checks.value;
  }
  const rg = root?.root_group?.checks;
  if (!rg) return null;
  let passes = 0;
  let fails = 0;
  for (const c of Object.values(rg)) {
    passes += c.passes ?? 0;
    fails += c.fails ?? 0;
  }
  const t = passes + fails;
  return t > 0 ? passes / t : null;
}

function expectedStatusRate(metrics) {
  const m = metrics.expected_status;
  if (!m || typeof m.value !== "number") return null;
  return m.value;
}

function other5xxRate(metrics) {
  return metricRate(metrics.status_other_5xx);
}

function rate503(metrics) {
  return metricRate(metrics.status_503);
}

function tier0HardFail(metrics, root, flags) {
  const reasons = [];
  const dur = durationMetric(metrics);
  const p99Explicit = dur && typeof dur["p(99)"] === "number" ? dur["p(99)"] : null;
  const tailMs = p99Explicit ?? (dur ? percentile(dur, "max") : 0);
  if (tailMs > 8000) {
    reasons.push(
      p99Explicit != null
        ? `p(99) ${tailMs.toFixed(0)}ms > 8000ms (timeout collapse)`
        : `max latency ${tailMs.toFixed(0)}ms > 8000ms (no p(99) in summary; using max)`,
    );
  }

  const o5 = other5xxRate(metrics);
  if (o5 > 0.005) reasons.push(`other_5xx rate ${(o5 * 100).toFixed(3)}% > 0.5%`);

  if (flags.tenantInvariantFail) reasons.push("tenant / JWT invariant probe reported failure (TENANT_INVARIANT_FAIL=1)");

  return { fail: reasons.length > 0, reasons };
}

function tier1Correctness(metrics, root, flags) {
  let d = 0;
  const notes = [];

  const expected = expectedStatusRate(metrics);
  const checkRate = checksPassRate(metrics, root);
  const passRate = expected ?? checkRate ?? 1;
  const unexpectedPct = (1 - passRate) * 100;
  if (unexpectedPct > 0) {
    const pen = Math.min(40, unexpectedPct / 0.1);
    d += pen;
    notes.push(`unexpected handling: ${unexpectedPct.toFixed(3)}% → -${pen.toFixed(1)} (cap 40)`);
  }

  if (flags.rateLimitLeak) {
    d += 5;
    notes.push("rate-limit leakage flagged (RATE_LIMIT_LEAK=1) → -5");
  }
  if (flags.modeIsolationFail) {
    d += 10;
    notes.push("mode isolation / v1 proxy leakage flagged (MODE_ISOLATION_FAIL=1) → -10");
  }

  d = Math.min(40, d);
  return { deduction: d, score: 40 - d, notes };
}

function tier2Latency(metrics, baselineMetrics, flags) {
  const dur = durationMetric(metrics);
  if (!dur) return { deduction: 0, score: 30, notes: ["no http_req_duration — Tier 2 skipped"] };

  const med = percentile(dur, "med");
  const p95 = percentile(dur, "p(95)");
  const p99 = percentile(dur, "p(99)") || percentile(dur, "max");

  let d = 0;
  const notes = [];

  if (med > 200) {
    const pen = Math.ceil((med - 200) / 50) * 2;
    if (pen > 0) {
      d += pen;
      notes.push(`p50(med) ${med.toFixed(0)}ms > 200ms → -${pen} (-2 per +50ms bucket, ceil)`);
    }
  }
  if (p95 > 1000) {
    const pen = Math.ceil((p95 - 1000) / 250) * 5;
    if (pen > 0) {
      d += pen;
      notes.push(`p95 ${p95.toFixed(0)}ms > 1000ms → -${pen} (-5 per +250ms bucket, ceil)`);
    }
  }
  if (p99 > 2000) {
    const pen = Math.ceil((p99 - 2000) / 500) * 10;
    if (pen > 0) {
      d += pen;
      notes.push(`tail ${p99.toFixed(0)}ms > 2000ms → -${pen} (-10 per +500ms bucket, ceil; uses p(99) or max if absent)`);
    }
  }

  d = Math.min(30, d);

  const baseDur = baselineMetrics ? durationMetric(baselineMetrics) : null;
  if (baseDur) {
    const baseP95 = percentile(baseDur, "p(95)");
    if (baseP95 > 0 && p95 > 2 * baseP95) {
      d += 10;
      notes.push(`p95 ${p95.toFixed(0)}ms > 2× baseline p95 ${baseP95.toFixed(0)}ms → -10 (tail collapse vs baseline)`);
    }
  } else if (flags.tailCollapse) {
    d += 10;
    notes.push("tail collapse flagged (TAIL_COLLAPSE=1) → -10");
  }

  d = Math.min(30, d);
  return { deduction: d, score: 30 - d, notes };
}

function tier3Shedding(overloadMetrics, primaryMetrics) {
  const notes = [];
  if (!overloadMetrics) {
    notes.push("No overload summary provided — shedding not measured (no deduction; caveat in verdict).");
    return { deduction: 0, score: 20, notes, measured: false };
  }

  const reqCount = overloadMetrics.http_reqs?.count ?? 0;
  if (reqCount === 0) {
    notes.push("Overload summary has zero http_reqs — ignoring for Tier 3 (stale or failed run).");
    return { deduction: 0, score: 20, notes, measured: false };
  }

  const dur = durationMetric(overloadMetrics);
  const p95 = dur ? percentile(dur, "p(95)") : 0;
  const r503 = rate503(overloadMetrics);
  const o5 = other5xxRate(overloadMetrics);

  let d = 0;

  if (o5 > 0.02 && p95 > 2000) {
    d += 20;
    notes.push("chaotic mix: elevated other_5xx with high latency → -20");
  } else if (r503 < 0.001 && p95 > 3000) {
    d += 15;
    notes.push("no 503 shedding but p95>3s under overload → -15 (queueing)");
  } else if (r503 >= 0.01 && r503 <= 0.1) {
    notes.push(`503 rate ${(r503 * 100).toFixed(2)}% in healthy shed band (1–10%)`);
  } else if (r503 > 0.1) {
    d += 10;
    notes.push(`very high 503 ${(r503 * 100).toFixed(1)}% → -10 (may be over-shedding / client errors)`);
  }

  d = Math.min(20, d);
  if (notes.length === 0) {
    notes.push(
      `503 rate ${(r503 * 100).toFixed(2)}%, p95 ${p95 > 0 ? `${p95.toFixed(0)}ms` : "n/a"} — no Tier-3 penalty applied`,
    );
  }
  return { deduction: d, score: 20 - d, notes, measured: true };
}

function tier4Stability(flags) {
  const notes = [];
  let d = 0;
  if (flags.spikeWave) {
    d += 5;
    notes.push("saturation spike wave (STABILITY_SPIKE=1) → -5");
  }
  if (flags.coldStartRegression) {
    d += 5;
    notes.push("cold-start regression (COLD_REGRESSION=1) → -5");
  }
  if (notes.length === 0) notes.push("No stability side-signals (set STABILITY_* env to penalize).");
  d = Math.min(10, d);
  return { deduction: d, score: 10 - d, notes };
}

function verdictBand(score) {
  if (score >= 90) return { label: "Production ready", emoji: "PASS" };
  if (score >= 75) return { label: "Safe but needs tuning", emoji: "WARN" };
  if (score >= 60) return { label: "Risky under load", emoji: "RISK" };
  return { label: "Not production safe", emoji: "FAIL" };
}

function readFlags() {
  return {
    tenantInvariantFail: process.env.TENANT_INVARIANT_FAIL === "1",
    rateLimitLeak: process.env.RATE_LIMIT_LEAK === "1",
    modeIsolationFail: process.env.MODE_ISOLATION_FAIL === "1",
    tailCollapse: process.env.TAIL_COLLAPSE === "1",
    spikeWave: process.env.STABILITY_SPIKE === "1",
    coldStartRegression: process.env.COLD_REGRESSION === "1",
  };
}

function primarySummary(paths) {
  /** Merge: use first file as primary aggregate; if multiple, log warning. */
  if (paths.length === 1) return loadSummary(paths[0]);
  let merged = null;
  for (const p of paths) {
    const s = loadSummary(p);
    if (!merged) merged = s;
    else {
      console.warn(`[score-run] multiple --summary files; scoring first only: ${paths[0]}`);
      break;
    }
  }
  return merged;
}

function main() {
  const args = parseArgs(process.argv);
  const flags = readFlags();
  const data = primarySummary(args.summaries);
  const metrics = data.metrics ?? {};
  const root = data;

  const baselineData = args.baseline ? loadSummary(args.baseline) : null;
  const baselineMetrics = baselineData?.metrics ?? null;

  const overloadData = args.overload ? loadSummary(args.overload) : null;
  const overloadMetrics = overloadData?.metrics ?? null;

  const t0 = tier0HardFail(metrics, root, flags);
  if (t0.fail) {
    const vb = verdictBand(0);
    const block = {
      tier0: "FAIL",
      reasons: t0.reasons,
      score: 0,
      verdict: vb.label,
      verdictCode: vb.emoji,
    };
    emit(block, args);
    process.exit(1);
  }

  const t1 = tier1Correctness(metrics, root, flags);
  const t2 = tier2Latency(metrics, baselineMetrics, flags);
  const t3 = tier3Shedding(overloadMetrics, metrics);
  const t4 = tier4Stability(flags);

  const score = 100 - t1.deduction - t2.deduction - t3.deduction - t4.deduction;
  const vb = verdictBand(score);

  const primaryIssue = pickPrimaryIssue(t1, t2, t3, t4);

  const block = {
    tier0: "PASS",
    score: Math.round(score * 10) / 10,
    verdict: vb.label,
    verdictCode: vb.emoji,
    tiers: {
      correctness: { weight: 40, score: Math.round(t1.score * 10) / 10, notes: t1.notes },
      latency: { weight: 30, score: Math.round(t2.score * 10) / 10, notes: t2.notes },
      shedding: {
        weight: 20,
        score: Math.round(t3.score * 10) / 10,
        notes: t3.notes,
        measured: t3.measured,
      },
      stability: { weight: 10, score: Math.round(t4.score * 10) / 10, notes: t4.notes },
    },
    primaryIssue,
    caveats: buildCaveats(t3, args),
  };

  emit(block, args);

  if (args.failBelow != null && Number.isFinite(args.failBelow) && score < args.failBelow) {
    process.exit(2);
  }
}

function pickPrimaryIssue(t1, t2, t3, t4) {
  const ranked = [
    { k: "correctness", d: t1.deduction },
    { k: "latency", d: t2.deduction },
    { k: "load shedding", d: t3.deduction },
    { k: "stability", d: t4.deduction },
  ].sort((a, b) => b.d - a.d);
  if (ranked[0].d === 0) return "No major tier deductions in automated signals.";
  if (ranked[0].k === "load shedding" && t3.measured === false) return "Shedding not measured — add --overload-summary from an overload scenario.";
  return `Largest automated deduction: ${ranked[0].k} (${ranked[0].d.toFixed(1)} pts).`;
}

function buildCaveats(t3, args) {
  const c = [];
  if (!t3.measured) c.push("Tier 3 shedding was not evaluated (no overload summary).");
  if (!args.baseline) c.push("No baseline summary — Tier 2 tail-vs-baseline comparison skipped.");
  c.push("Tenant/JWT invariant checks require explicit probes (TENANT_INVARIANT_FAIL=1 if violated).");
  return c;
}

function emit(block, args) {
  if (args.json) {
    console.log(JSON.stringify(block, null, 2));
    return;
  }
  const md = renderMarkdown(block);
  if (args.outPath) writeFileSync(args.outPath, md, "utf8");
  console.log(md);
  if (args.outPath) console.error(`[score-run] wrote ${args.outPath}`);
}

function renderMarkdown(b) {
  if (b.tier0 === "FAIL") {
    return `# Flux Gateway Scorecard\n\n## Tier 0 — **FAIL**\n\n${b.reasons.map((r) => `- ${r}`).join("\n")}\n\n**Score:** 0 — **${b.verdict}** (${b.verdictCode})\n`;
  }

  const { tiers, score, verdict, verdictCode, primaryIssue, caveats } = b;
  return `# Flux Gateway Scorecard

**Flux Score:** **${score}** / 100  
**Verdict:** **${verdict}** (${verdictCode})

## Tier 0 — Hard fail

**PASS** (no uncontrolled 5xx burst, no p99/max tail > 8s in this summary, no tenant flag)

## Tier scores (remaining weights)

| Tier | Weight | Score | Notes |
|------|--------|------:|-------|
| Correctness | 40 | ${tiers.correctness.score} | ${tiers.correctness.notes.join("; ") || "—"} |
| Latency | 30 | ${tiers.latency.score} | ${tiers.latency.notes.join("; ") || "—"} |
| Load shedding | 20 | ${tiers.shedding.score} | ${tiers.shedding.notes.join("; ") || "—"} |
| Stability | 10 | ${tiers.stability.score} | ${tiers.stability.notes.join("; ") || "—"} |

## Primary issue

${primaryIssue}

## Caveats

${caveats.map((x) => `- ${x}`).join("\n")}

---
*Deductions are capped per tier. Tune thresholds in \`perf/k6/score-run.mjs\` as you gather more labeled runs.*
`;
}

main();
