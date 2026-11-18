import { prisma } from '../config/database';
import { istDateKey } from '../utils/helpers';
import { AdminScope, ListFilters, buildListWhere, decodeCursor, encodeCursor } from './feedbackAdmin.service';

export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_PAGE = 500;
export const CSV_BOM = '﻿';

const HEADER = [
  'id', 'created_at', 'kind', 'status', 'priority', 'moderation', 'canteen', 'overall_rating', 'tags',
  'is_anonymous', 'author_name', 'author_email', 'body', 'has_photo', 'assigned_to', 'first_seen_at', 'resolved_at',
];

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (= + - @ tab CR) gets a leading
 * single quote, then the cell is always quoted with embedded quotes doubled.
 */
export function csvCell(v: unknown): string {
  if (v == null) return '""';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

/** Filename with the IST calendar date, e.g. feedback-2026-11-18.csv */
export function exportFilename(now = new Date()): string {
  const k = istDateKey(now);
  return `feedback-${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}.csv`;
}

interface ExportRow {
  id: string; createdAt: Date; kind: string; status: string; priority: string; moderation: string;
  canteen: { name: string } | null; overallRating: number | null; tags: string[]; isAnonymous: boolean;
  userId: string | null; body: string | null; bodyRedacted: string | null; assignedTo: string | null;
  firstSeenAt: Date | null; resolvedAt: Date | null; _count: { attachments: number };
}

export function toCsvRow(r: ExportRow, author: { name: string | null; email: string | null } | null, rawBody: boolean): string {
  // Identity columns are blank for anonymous rows, whatever the caller's role.
  const who = r.isAnonymous ? null : author;
  return csvRow([
    r.id, r.createdAt, r.kind, r.status, r.priority, r.moderation, r.canteen?.name ?? '', r.overallRating ?? '',
    r.tags.join(';'), r.isAnonymous ? 'yes' : 'no', who?.name ?? '', who?.email ?? '',
    rawBody ? r.body ?? '' : r.bodyRedacted ?? '', r._count.attachments > 0 ? 'yes' : 'no',
    r.assignedTo ?? '', r.firstSeenAt, r.resolvedAt,
  ]);
}

/**
 * Yields the CSV in chunks, one database page at a time (keyset cursor), up to the row cap.
 * Nothing holds more than one page in memory. onCount receives the running row count.
 */
export async function* exportChunks(
  scope: AdminScope, filters: Omit<ListFilters, 'limit' | 'cursor'>, rawBody: boolean,
  onCount?: (n: number) => void, maxRows = EXPORT_MAX_ROWS,
): AsyncGenerator<string> {
  yield CSV_BOM + csvRow(HEADER);
  let cursor: string | undefined;
  let total = 0;
  while (total < maxRows) {
    const take = Math.min(EXPORT_PAGE, maxRows - total);
    const where = buildListWhere(scope, { ...filters, limit: take, cursor });
    const rows = await prisma.feedback.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true, createdAt: true, kind: true, status: true, priority: true, moderation: true, overallRating: true,
        tags: true, isAnonymous: true, userId: true, body: true, bodyRedacted: true, assignedTo: true,
        firstSeenAt: true, resolvedAt: true, canteen: { select: { name: true } }, _count: { select: { attachments: true } },
      },
    });
    if (!rows.length) break;

    // Look identities up only for non-anonymous rows.
    const ids = [...new Set(rows.filter((r) => !r.isAnonymous && r.userId).map((r) => r.userId as string))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    let chunk = '';
    for (const r of rows) chunk += toCsvRow(r as ExportRow, r.userId ? byId.get(r.userId) ?? null : null, rawBody);
    total += rows.length;
    onCount?.(total);
    yield chunk;

    if (rows.length < take) break;
    const last = rows[rows.length - 1];
    cursor = encodeCursor(last.createdAt, last.id);
    decodeCursor(cursor); // fail loudly if the encoding ever drifts
  }
}

/** Audit row first (so a dropped connection is still recorded), row count patched when streaming ends. */
export async function startExportAudit(actorId: string, filters: unknown) {
  return prisma.feedbackExportAudit.create({
    data: { actorId, filtersJson: JSON.parse(JSON.stringify(filters ?? {})), rowCount: 0 },
    select: { id: true },
  });
}

export async function finishExportAudit(id: string, rowCount: number) {
  await prisma.feedbackExportAudit.update({ where: { id }, data: { rowCount } });
}
