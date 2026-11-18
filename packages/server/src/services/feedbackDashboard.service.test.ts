import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({}));
vi.mock('../config/database', () => ({ prisma: db }));

import { feedbackDashboard, clampDays } from './feedbackDashboard.service';

beforeEach(() => {
  db.$queryRaw = vi.fn(async (sql: any) => {
    const t = sql.strings.join('?');
    if (t.includes('percentile_cont')) return [{ median_secs: 5400, total: 10n, resolved: 4n }];
    if (t.includes('JOIN canteens')) return [
      { canteen_id: 'a', name: 'Small', avg: 5, n: 3n },
      { canteen_id: 'b', name: 'Big', avg: 4.26, n: 40n },
    ];
    if (t.includes('unnest')) return [{ tag: 'payment', n: 3n }, { tag: 'not-a-tag', n: 9n }];
    if (t.includes('overall_rating AS rating')) return [{ rating: 5, n: 2n }];
    if (t.includes('appVersion')) return [{ version: '1.2.0', n: 2n }];
    return [{ bucket: '2026-11-18', avg: 4.25, n: 4n }];
  });
});

describe('feedbackDashboard', () => {
  it('clamps the range to 1..180 days, default 30', () => {
    expect(clampDays(undefined)).toBe(30);
    expect(clampDays(999)).toBe(180);
    expect(clampDays(0)).toBe(30);
  });

  it('binds the scope as a parameter and never inlines it', async () => {
    const evil = "x'; DROP TABLE feedback;--";
    await feedbackDashboard({ institutionId: evil });
    expect(db.$queryRaw).toHaveBeenCalledTimes(7);
    for (const [sql] of db.$queryRaw.mock.calls) {
      expect(sql.strings.join('')).not.toContain('DROP');
      expect(sql.values).toContain(evil);
      expect(sql.strings.join('')).toContain("moderation::text <> 'HIDDEN'");
    }
  });

  it('shapes the response, withholds averages below 10 ratings and ranks enough-data canteens first', async () => {
    const d = await feedbackDashboard({});
    expect(d.leaderboard[0]).toMatchObject({ name: 'Big', enoughData: true, avg: 4.3, sampleSize: 40 });
    expect(d.leaderboard[1]).toMatchObject({ name: 'Small', enoughData: false, avg: null, sampleSize: 3 });
    expect(d.distribution.map((x) => x.count)).toEqual([0, 0, 0, 0, 2]);
    expect(d.topComplaintTags).toEqual([{ tag: 'payment', count: 3 }]);
    expect(d.response).toEqual({ medianFirstResponseHours: 1.5, total: 10, resolved: 4, resolutionRate: 40 });
    expect(d.bugsByVersion).toEqual([{ version: '1.2.0', count: 2 }]);
    expect(d.ratingTrend.daily[0]).toEqual({ date: '2026-11-18', avg: 4.3, count: 4 });
  });
});
