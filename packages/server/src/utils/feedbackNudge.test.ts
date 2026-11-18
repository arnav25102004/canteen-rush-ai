import { describe, it, expect } from 'vitest';
import { computeNudgeAt, inQuietHours, avoidQuietHours } from './feedbackNudge';

// IST = UTC+5:30. 12:00 IST = 06:30Z.
const ist = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);
const MIN = 60 * 1000;

describe('computeNudgeAt', () => {
  it('adds 25 to 40 minutes in daytime', () => {
    const t = ist('2026-11-18', '12:00');
    expect(computeNudgeAt(t, () => 0).getTime() - t.getTime()).toBe(25 * MIN);
    expect(computeNudgeAt(t, () => 1).getTime() - t.getTime()).toBe(40 * MIN);
    const mid = computeNudgeAt(t, () => 0.5).getTime() - t.getTime();
    expect(mid).toBeGreaterThanOrEqual(25 * MIN);
    expect(mid).toBeLessThanOrEqual(40 * MIN);
  });
  it('moves a nudge landing at or after 22:00 IST to 08:00 IST next morning', () => {
    const t = ist('2026-11-18', '21:50'); // +25 min = 22:15
    expect(computeNudgeAt(t, () => 0)).toEqual(ist('2026-11-19', '08:00'));
  });
  it('moves a nudge landing before 08:00 IST to 08:00 IST the same morning', () => {
    const t = ist('2026-11-18', '07:20'); // +25 min = 07:45
    expect(computeNudgeAt(t, () => 0)).toEqual(ist('2026-11-18', '08:00'));
    const late = ist('2026-11-18', '00:30');
    expect(computeNudgeAt(late, () => 0.3)).toEqual(ist('2026-11-18', '08:00'));
  });
  it('keeps 21:30 + 25 = 21:55 and 08:00 exactly', () => {
    expect(computeNudgeAt(ist('2026-11-18', '21:30'), () => 0)).toEqual(ist('2026-11-18', '21:55'));
    expect(avoidQuietHours(ist('2026-11-18', '08:00'))).toEqual(ist('2026-11-18', '08:00'));
  });
  it('quiet hours boundaries are 22:00 inclusive to 08:00 exclusive', () => {
    expect(inQuietHours(ist('2026-11-18', '21:59'))).toBe(false);
    expect(inQuietHours(ist('2026-11-18', '22:00'))).toBe(true);
    expect(inQuietHours(ist('2026-11-18', '07:59'))).toBe(true);
    expect(inQuietHours(ist('2026-11-18', '08:00'))).toBe(false);
  });
  it('rolls over a month end', () => {
    expect(computeNudgeAt(ist('2026-11-30', '22:00'), () => 0)).toEqual(ist('2026-12-01', '08:00'));
  });
});
