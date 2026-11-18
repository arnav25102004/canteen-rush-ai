import { istDateKey } from '../../utils/helpers';
import { AssistantConfig, loadAssistantConfig } from '../config';
import { ModelSpec, configuredModels } from '../models';
import { breaker as defaultBreaker, CircuitBreaker } from './breaker';
import { RateLimitInfo } from './types';

export const SHIFT_FRACTION = 0.7; // student or app at 70% of its daily budget
export const MAIN_DAILY_FRACTION = 0.85; // main at 85% of its own daily limit
const DEFAULT_COOLDOWN_MS = 20_000;
const MAX_COOLDOWN_MS = 5 * 60_000;
const WINDOW_MS = 60_000;

export interface PickInput {
  userTokensToday: number;
  globalTokensToday: number;
  estInputTokens: number;
  needTools: boolean;
}

interface ModelState {
  cooldownUntil: number;
  day: string;
  tokensToday: number;
  requestsToday: number;
  window: Array<{ t: number; tokens: number }>;
  remainingTokens?: number;
  remainingRequests?: number;
  tokensFreshUntil: number;
  requestsFreshUntil: number;
}

export class ModelGovernor {
  private state = new Map<string, ModelState>();

  constructor(
    private readonly brk: CircuitBreaker = defaultBreaker,
    private readonly now: () => number = () => Date.now(),
    private readonly day: () => string = () => istDateKey(),
  ) {}

  private st(model: string): ModelState {
    let s = this.state.get(model);
    const today = this.day();
    if (!s) {
      s = { cooldownUntil: 0, day: today, tokensToday: 0, requestsToday: 0, window: [], tokensFreshUntil: 0, requestsFreshUntil: 0 };
      this.state.set(model, s);
    }
    if (s.day !== today) {
      s.day = today;
      s.tokensToday = 0;
      s.requestsToday = 0;
    }
    return s;
  }

  /** Puts a model out of rotation for `ms` (a 429 with a long retry-after). */
  cooldown(model: string, ms: number = DEFAULT_COOLDOWN_MS): void {
    const d = Math.min(Math.max(0, ms), MAX_COOLDOWN_MS);
    const s = this.st(model);
    s.cooldownUntil = Math.max(s.cooldownUntil, this.now() + d);
  }

  isCoolingDown(model: string): boolean {
    return this.st(model).cooldownUntil > this.now();
  }

  /** Records a finished call and the provider's x-ratelimit-* headers. */
  noteUsage(model: string, tokens: number, headers?: RateLimitInfo): void {
    const s = this.st(model);
    const t = this.now();
    const n = Math.max(0, tokens || 0);
    s.tokensToday += n;
    if (n > 0 || !headers) s.requestsToday += 1;
    s.window = s.window.filter((w) => t - w.t < WINDOW_MS);
    if (n > 0 || !headers) s.window.push({ t, tokens: n });
    if (headers) {
      if (headers.remainingTokens !== undefined) {
        s.remainingTokens = headers.remainingTokens;
        s.tokensFreshUntil = t + (headers.resetTokensMs ?? WINDOW_MS);
      }
      if (headers.remainingRequests !== undefined) {
        s.remainingRequests = headers.remainingRequests;
        s.requestsFreshUntil = t + (headers.resetRequestsMs ?? WINDOW_MS);
      }
    }
  }

  /** Fraction (0..) of the model's own daily limit used, or 0 when no limit is known. */
  dailyFraction(spec: ModelSpec): number {
    const s = this.st(spec.id);
    const f: number[] = [];
    if (spec.limits.tpd) f.push(s.tokensToday / spec.limits.tpd);
    if (spec.limits.rpd) f.push(s.requestsToday / spec.limits.rpd);
    return f.length ? Math.max(...f) : 0;
  }

  /** Whether the model's per-minute window can fit a call of about `estTokens`. */
  fitsMinute(spec: ModelSpec, estTokens: number): boolean {
    const s = this.st(spec.id);
    const t = this.now();
    const recent = s.window.filter((w) => t - w.t < WINDOW_MS);
    const used = recent.reduce((a, w) => a + w.tokens, 0);
    if (spec.limits.tpm && used + estTokens > spec.limits.tpm) return false;
    if (spec.limits.rpm && recent.length + 1 > spec.limits.rpm) return false;
    if (s.remainingTokens !== undefined && t < s.tokensFreshUntil && s.remainingTokens < estTokens) return false;
    if (s.remainingRequests !== undefined && t < s.requestsFreshUntil && s.remainingRequests < 1) return false;
    return true;
  }

  /** Whether a model can be tried at all right now. */
  usable(spec: ModelSpec, estTokens: number): boolean {
    return !this.brk.isOpen(spec.id) && !this.isCoolingDown(spec.id) && this.dailyFraction(spec) < 1 && this.fitsMinute(spec, estTokens);
  }

  /**
   * Models to try, best first. Normal order is main, fallback, fast. It shifts to
   * fast, fallback, main when the student or the app is at 70% of its daily budget,
   * or main is at 85% of its own daily limit. Models that cannot take the call
   * now (open breaker, cooldown, spent daily limit, no minute headroom) are left out.
   */
  pickChain(input: PickInput, cfg: AssistantConfig = loadAssistantConfig()): ModelSpec[] {
    const all = configuredModels(cfg);
    const byRole = (r: string) => all.find((m) => m.role === r);
    const main = byRole('main');
    const fallback = byRole('fallback');
    const fast = byRole('fast');
    const budgetHigh =
      input.userTokensToday >= SHIFT_FRACTION * cfg.userDailyTokens ||
      input.globalTokensToday >= SHIFT_FRACTION * cfg.globalDailyTokens;
    const mainHigh = !!main && this.dailyFraction(main) >= MAIN_DAILY_FRACTION;
    const shift = budgetHigh || mainHigh;

    const order = (shift ? [fast, fallback, main] : [main, fallback, fast]).filter((m): m is ModelSpec => !!m);
    return order.filter((spec) => {
      if (input.needTools && !spec.tools) return false;
      return this.usable(spec, input.estInputTokens + spec.maxTokens);
    });
  }

  /** Whether at least one model is not behind an open breaker (for /capabilities). */
  anyBreakerClosed(cfg: AssistantConfig = loadAssistantConfig()): boolean {
    return configuredModels(cfg).some((m) => !this.brk.isOpen(m.id));
  }

  reset() {
    this.state.clear();
  }
}

export const governor = new ModelGovernor();
export const pickChain = (input: PickInput, cfg?: AssistantConfig) => governor.pickChain(input, cfg);
export const noteUsage = (model: string, tokens: number, headers?: RateLimitInfo) => governor.noteUsage(model, tokens, headers);
export const cooldown = (model: string, ms?: number) => governor.cooldown(model, ms);
