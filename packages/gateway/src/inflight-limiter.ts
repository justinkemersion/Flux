export interface InflightLimiter {
  tryAcquire(): boolean;
  release(durationMs?: number): void;
  getCurrent(): number;
  getCap(): number;
}

export class FixedInflightLimiter implements InflightLimiter {
  #max: number;
  #current = 0;

  constructor(max: number) {
    this.#max = Math.max(1, Math.floor(max));
  }

  tryAcquire(): boolean {
    if (this.#current >= this.#max) return false;
    this.#current++;
    return true;
  }

  release(): void {
    this.#current = Math.max(0, this.#current - 1);
  }

  getCurrent(): number {
    return this.#current;
  }

  getCap(): number {
    return this.#max;
  }
}

class LatencyTracker {
  #samples: number[] = [];
  #maxSamples: number;

  constructor(maxSamples: number) {
    this.#maxSamples = Math.max(10, Math.floor(maxSamples));
  }

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.#samples.push(ms);
    if (this.#samples.length > this.#maxSamples) {
      this.#samples.shift();
    }
  }

  p95(): number {
    if (this.#samples.length === 0) return 0;
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx] ?? 0;
  }
}

export interface AdaptiveLimiterConfig {
  initialCap: number;
  minCap: number;
  hardMax: number;
  targetLatencyMs: number;
  upStep: number;
  downFactor: number;
  maxSamples: number;
}

export class AdaptiveInflightLimiter implements InflightLimiter {
  #cap: number;
  #current = 0;
  #cfg: AdaptiveLimiterConfig;
  #tracker: LatencyTracker;

  constructor(cfg: AdaptiveLimiterConfig) {
    this.#cfg = cfg;
    this.#cap = clamp(Math.floor(cfg.initialCap), cfg.minCap, cfg.hardMax);
    this.#tracker = new LatencyTracker(cfg.maxSamples);
  }

  tryAcquire(): boolean {
    if (this.#current >= this.#cap) return false;
    this.#current++;
    return true;
  }

  release(durationMs?: number): void {
    this.#current = Math.max(0, this.#current - 1);
    if (typeof durationMs === "number") this.#tracker.record(durationMs);
  }

  tick(): void {
    const p95 = this.#tracker.p95();
    if (p95 <= 0) return;

    if (p95 < this.#cfg.targetLatencyMs * 0.8) {
      this.#cap += this.#cfg.upStep;
    } else if (p95 > this.#cfg.targetLatencyMs) {
      this.#cap = Math.floor(this.#cap * this.#cfg.downFactor);
    }

    this.#cap = clamp(this.#cap, this.#cfg.minCap, this.#cfg.hardMax);
  }

  getCurrent(): number {
    return this.#current;
  }

  getCap(): number {
    return this.#cap;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
