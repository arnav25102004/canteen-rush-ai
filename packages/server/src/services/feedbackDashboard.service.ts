import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { FEEDBACK_TAGS } from '../utils/feedbackSchemas';
import { AdminScope } from './feedbackAdmin.service';

export const DASH_MAX_DAYS = 180;
export const DASH_DEFAULT_DAYS = 30;
export const LEADERBOARD_MIN_RATINGS = 10;

const num = (v: unknown) => (v == null ? 0 : Number(v));
const round1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);

/** Scope as bound parameters only; never interpolated text. */
function scopeSql(scope: AdminScope): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (scope.institutionId) parts.push(Prisma.sql`AND f.institution_id = ${scope.institutionId}`);
  if (scope.canteenId) parts.push(Prisma.sql`AND f.canteen_id = ${scope.canteenId}`);
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
}

// Hidden and deleted feedback never counts.
const VISIBLE = Prisma.sql`f.deleted_at IS NULL AND f.moderation::text <> 'HIDDEN'`;
// Created_at is stored as UTC without a zone; shift to IST before bucketing.
const IST_TS = Prisma.sql`((f.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')`;

export function clampDays(days: number | undefined): number {
  const d = Math.floor(days ?? DASH_DEFAULT_DAYS);
  if (!Number.isFinite(d) || d < 1) return DASH_DEFAULT_DAYS;
  return Math.min(d, DASH_MAX_DAYS);
}

export async function feedbackDashboard(scope: AdminScope, daysIn?: number, now = new Date()) {
  const days = clampDays(daysIn);
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const sc = scopeSql(scope);
  const base = Prisma.sql`${VISIBLE} AND f.created_at >= ${since} ${sc}`;
  const rated = Prisma.sql`${base} AND f.overall_rating IS NOT NULL`;

  const [daily, weekly, dist, tags, board, response, bugs] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; avg: number; n: bigint }[]>(Prisma.sql`
      SELECT to_char(${IST_TS}::date, 'YYYY-MM-DD') AS bucket, AVG(f.overall_rating)::float AS avg, COUNT(*) AS n
      FROM feedback f WHERE ${rated} GROUP BY 1 ORDER BY 1 LIMIT 400`),
    prisma.$queryRaw<{ bucket: string; avg: number; n: bigint }[]>(Prisma.sql`
      SELECT to_char(date_trunc('week', ${IST_TS})::date, 'YYYY-MM-DD') AS bucket, AVG(f.overall_rating)::float AS avg, COUNT(*) AS n
      FROM feedback f WHERE ${rated} GROUP BY 1 ORDER BY 1 LIMIT 60`),
    prisma.$queryRaw<{ rating: number; n: bigint }[]>(Prisma.sql`
      SELECT f.overall_rating AS rating, COUNT(*) AS n FROM feedback f WHERE ${rated} GROUP BY 1 ORDER BY 1`),
    // Complaint tags: tags on low ratings (1-2 stars) and on bug reports.
    prisma.$queryRaw<{ tag: string; n: bigint }[]>(Prisma.sql`
      SELECT t AS tag, COUNT(*) AS n
      FROM feedback f, unnest(f.tags) AS t
      WHERE ${base} AND (f.overall_rating <= 2 OR f.kind::text = 'APP_BUG')
      GROUP BY t ORDER BY n DESC LIMIT 30`),
    prisma.$queryRaw<{ canteen_id: string; name: string; avg: number; n: bigint }[]>(Prisma.sql`
      SELECT f.canteen_id, c.name, AVG(f.overall_rating)::float AS avg, COUNT(*) AS n
      FROM feedback f JOIN canteens c ON c.id = f.canteen_id
      WHERE ${rated} GROUP BY f.canteen_id, c.name ORDER BY avg DESC, n DESC LIMIT 100`),
    prisma.$queryRaw<{ median_secs: number | null; total: bigint; resolved: bigint }[]>(Prisma.sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (f.first_seen_at - f.created_at)))
               FILTER (WHERE f.first_seen_at IS NOT NULL)::float AS median_secs,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE f.resolved_at IS NOT NULL) AS resolved
      FROM feedback f WHERE ${base}`),
    prisma.$queryRaw<{ version: string; n: bigint }[]>(Prisma.sql`
      SELECT COALESCE(NULLIF(f.context_json->>'appVersion', ''), 'unknown') AS version, COUNT(*) AS n
      FROM feedback f WHERE ${base} AND f.kind::text = 'APP_BUG'
      GROUP BY 1 ORDER BY n DESC LIMIT 20`),
  ]);

  const total = num(response[0]?.total);
  const resolved = num(response[0]?.resolved);
  return {
    days,
    ratingTrend: {
      daily: daily.map((r) => ({ date: r.bucket, avg: round1(r.avg), count: num(r.n) })),
      weekly: weekly.map((r) => ({ weekStart: r.bucket, avg: round1(r.avg), count: num(r.n) })),
    },
    distribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: num(dist.find((d) => d.rating === rating)?.n) })),
    topComplaintTags: tags.filter((t) => FEEDBACK_TAGS.includes(t.tag)).slice(0, 8).map((t) => ({ tag: t.tag, count: num(t.n) })),
    leaderboard: [...board].sort((a, b) => {
      // Canteens with enough data rank first; the rest follow by sample size.
      const ea = num(a.n) >= LEADERBOARD_MIN_RATINGS, eb = num(b.n) >= LEADERBOARD_MIN_RATINGS;
      if (ea !== eb) return ea ? -1 : 1;
      return ea ? b.avg - a.avg : num(b.n) - num(a.n);
    }).map((b) => {
      const n = num(b.n);
      const enough = n >= LEADERBOARD_MIN_RATINGS;
      // Below the threshold the average is withheld so a handful of ratings is not ranked.
      return { canteenId: b.canteen_id, name: b.name, sampleSize: n, enoughData: enough, avg: enough ? round1(b.avg) : null };
    }),
    response: {
      medianFirstResponseHours: response[0]?.median_secs != null ? Math.round((Number(response[0].median_secs) / 3600) * 10) / 10 : null,
      total, resolved, resolutionRate: total ? Math.round((resolved / total) * 1000) / 10 : null,
    },
    bugsByVersion: bugs.map((b) => ({ version: b.version, count: num(b.n) })),
  };
}
