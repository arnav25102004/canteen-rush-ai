import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './breaker';
import { ModelGovernor } from './modelGovernor';
import { loadAssistantConfig } from '../config';
import { modelSpecFor } from '../models';

const cfg = loadAssistantConfig({} as NodeJS.ProcessEnv); // user 60k, global 150k
const [MAIN, FALLBACK, FAST] = [cfg.models.main, cfg.models.fallback, cfg.models.fast];
const base = { userTokensToday: 0, globalTokensToday: 0, estInputTokens: 1000, needTools: true };

function make() {
  let t = 5_000_000;
  const brk = new CircuitBreaker({ now: () => t });
  const gov = new ModelGovernor(brk, () => t, () => 'day');
  return {
    gov,
    brk,
    advance: (ms: number) => {
      t += ms;
    },
  };
}
const ids = (m: { id: string }[]) => m.map((x) => x.id);

describe('pickChain', () => {
  it('normal order is main, fallback, fast', () => {
    expect(ids(make().gov.pickChain(base, cfg))).toEqual([MAIN, FALLBACK, FAST]);
  });

  it('downshifts to fast, fallback at 70% of the student budget (exact threshold)', () => {
    const { gov } = make();
    expect(ids(gov.pickChain({ ...base, userTokensToday: 41_999 }, cfg))[0]).toBe(MAIN);
    expect(ids(gov.pickChain({ ...base, userTokensToday: 42_000 }, cfg))).toEqual([FAST, FALLBACK, MAIN]);
  });

  it('downshifts at 70% of the global budget', () => {
    const { gov } = make();
    expect(ids(gov.pickChain({ ...base, globalTokensToday: 104_999 }, cfg))[0]).toBe(MAIN);
    expect(ids(gov.pickChain({ ...base, globalTokensToday: 105_000 }, cfg))[0]).toBe(FAST);
  });

  it('downshifts when main is at 85% of its own daily limit, and drops it at 100%', () => {
    const { gov, advance } = make();
    gov.noteUsage(MAIN, 169_000); // tpd 200k: 84.5%
    advance(61_000); // the per-minute window is empty again
    expect(ids(gov.pickChain(base, cfg))[0]).toBe(MAIN);
    gov.noteUsage(MAIN, 1_500); // 85.25%
    advance(61_000);
    expect(ids(gov.pickChain(base, cfg))).toEqual([FAST, FALLBACK, MAIN]);
    gov.noteUsage(MAIN, 40_000);
    advance(61_000);
    expect(ids(gov.pickChain(base, cfg))).toEqual([FAST, FALLBACK]);
  });

  it('drops main when its per-minute window cannot fit the call, and it recovers after a minute', () => {
    const { gov, advance } = make();
    gov.noteUsage(MAIN, 6_700); // tpm 8000, and 6700 + (1000 + 384) > 8000
    expect(ids(gov.pickChain(base, cfg))).toEqual([FALLBACK, FAST]);
    advance(60_001);
    expect(ids(gov.pickChain(base, cfg))[0]).toBe(MAIN);
  });

  it('uses x-ratelimit headers for headroom', () => {
    const { gov } = make();
    gov.noteUsage(MAIN, 100, { remainingTokens: 500, resetTokensMs: 20_000 });
    expect(ids(gov.pickChain(base, cfg))).not.toContain(MAIN);
    gov.noteUsage(FALLBACK, 100, { remainingRequests: 0, resetRequestsMs: 5_000 });
    expect(ids(gov.pickChain(base, cfg))).toEqual([FAST]);
  });

  it('skips models with an open breaker or a cooldown', () => {
    const { gov, brk, advance } = make();
    for (let i = 0; i < 3; i++) brk.recordFailure(MAIN);
    gov.cooldown(FALLBACK, 10_000);
    expect(ids(gov.pickChain(base, cfg))).toEqual([FAST]);
    advance(10_001);
    expect(ids(gov.pickChain(base, cfg))).toEqual([FALLBACK, FAST]);
    advance(20_000);
    expect(ids(gov.pickChain(base, cfg))).toEqual([MAIN, FALLBACK, FAST]);
  });

  it('caps a cooldown at 5 minutes', () => {
    const { gov, advance } = make();
    gov.cooldown(MAIN, 10 * 60_000);
    advance(5 * 60_000 + 1);
    expect(gov.isCoolingDown(MAIN)).toBe(false);
  });

  it('honours ASSISTANT_MODEL_LIMITS overrides', () => {
    const c = loadAssistantConfig({ ASSISTANT_MODEL_LIMITS: JSON.stringify({ [MAIN]: { tpm: 1000 } }) } as unknown as NodeJS.ProcessEnv);
    expect(ids(make().gov.pickChain(base, c))[0]).toBe(FALLBACK);
  });
  it('a model id outside the three roles is unknown: 256 tokens, no tools', () => {
    const spec = modelSpecFor('x/unknown', cfg);
    expect(spec).toMatchObject({ role: 'unknown', maxTokens: 256, tools: false });
    const { gov } = make();
    expect(gov.usable(spec, 500)).toBe(true);
  });
});
