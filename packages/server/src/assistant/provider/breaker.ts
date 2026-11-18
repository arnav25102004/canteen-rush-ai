export interface BreakerOptions {
  /** Outages within `windowMs` that open the breaker. */
  threshold?: number;
  windowMs?: number;
  /** How long an open breaker rejects calls. */
  openMs?: number;
  now?: () => number;
}

/**
 * Per-model circuit breaker: 3 outages (5xx, timeout, network) within 60s open
 * it for 30s. State is in memory per process, which is fine: each instance
 * simply learns about an outage on its own.
 */
export class CircuitBreaker {
  private failures = new Map<string, number[]>();
  private openUntil = new Map<string, number>();
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(opts: BreakerOptions = {}) {
    this.threshold = opts.threshold ?? 3;
    this.windowMs = opts.windowMs ?? 60_000;
    this.openMs = opts.openMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  isOpen(model: string): boolean {
    const until = this.openUntil.get(model);
    if (until === undefined) return false;
    if (this.now() < until) return true;
    this.openUntil.delete(model);
    this.failures.delete(model);
    return false;
  }

  recordFailure(model: string): void {
    const t = this.now();
    const recent = (this.failures.get(model) ?? []).filter((x) => t - x < this.windowMs);
    recent.push(t);
    this.failures.set(model, recent);
    if (recent.length >= this.threshold) {
      this.openUntil.set(model, t + this.openMs);
      this.failures.delete(model);
    }
  }

  recordSuccess(model: string): void {
    this.failures.delete(model);
  }

  reset(): void {
    this.failures.clear();
    this.openUntil.clear();
  }
}

export const breaker = new CircuitBreaker();
