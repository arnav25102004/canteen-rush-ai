import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({}));
vi.mock('../config/database', () => ({ prisma: db }));

import { csvCell, csvRow, exportChunks, exportFilename, CSV_BOM } from './feedbackExport.service';

const T = new Date('2026-11-18T12:00:00Z');
function fbRow(i: number, over: any = {}) {
  return {
    id: `id-${i}`, createdAt: new Date(T.getTime() - i * 1000), kind: 'APP_BUG', status: 'RECEIVED', priority: 'NORMAL',
    moderation: 'CLEAN', overallRating: null, tags: ['payment'], isAnonymous: false, userId: 'u1', body: 'raw body',
    bodyRedacted: 'red body', assignedTo: null, firstSeenAt: null, resolvedAt: null, canteen: { name: 'Main' },
    _count: { attachments: 0 }, ...over,
  };
}

beforeEach(() => {
  db.user = { findMany: vi.fn(async () => [{ id: 'u1', name: 'Asha', email: 'asha@x.in' }]) };
});

async function collect(gen: AsyncGenerator<string>) {
  let s = '';
  for await (const c of gen) s += c;
  return s;
}

describe('csvCell', () => {
  it('prefixes formula starters with a single quote', () => {
    for (const c of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) {
      expect(csvCell(c)).toBe(`"'${c}"`);
    }
  });
  it('quotes, doubles quotes and keeps newlines and commas intact', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe('""');
    expect(csvRow(['a', 'b'])).toBe('"a","b"\r\n');
  });
  it('leaves ordinary text alone', () => {
    expect(csvCell('hello - world')).toBe('"hello - world"');
  });
});

describe('exportFilename', () => {
  it('uses the IST date', () => {
    expect(exportFilename(new Date('2026-11-18T20:00:00Z'))).toBe('feedback-2026-11-19.csv'); // 01:30 IST next day
  });
});

describe('exportChunks', () => {
  it('starts with a BOM, pages with a cursor and scopes every page', async () => {
    db.feedback = {
      findMany: vi.fn()
        .mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => fbRow(i)))
        .mockResolvedValueOnce([fbRow(500)]),
    };
    const out = await collect(exportChunks({ institutionId: 'inst-1' }, {}, true));
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out.trimEnd().split('\r\n')).toHaveLength(502); // header + 501 rows
    expect(db.feedback.findMany).toHaveBeenCalledTimes(2);
    for (const [arg] of db.feedback.findMany.mock.calls) expect(arg.where.institutionId).toBe('inst-1');
    expect(JSON.stringify(db.feedback.findMany.mock.calls[1][0].where)).toContain('OR'); // cursor applied
  });

  it('caps at the row limit', async () => {
    db.feedback = { findMany: vi.fn(async ({ take }: any) => Array.from({ length: take }, (_, i) => fbRow(i))) };
    const counts: number[] = [];
    const out = await collect(exportChunks({}, {}, true, (n) => counts.push(n), 1200));
    expect(counts[counts.length - 1]).toBe(1200);
    expect(out.trimEnd().split('\r\n')).toHaveLength(1201);
    expect(db.feedback.findMany).toHaveBeenCalledTimes(3); // 500 + 500 + 200
  });

  it('never exports identity for anonymous rows, even if the row carries a user id', async () => {
    db.feedback = { findMany: vi.fn().mockResolvedValueOnce([fbRow(1, { isAnonymous: true }), fbRow(2)]) };
    const out = await collect(exportChunks({}, {}, true));
    const [, anon, named] = out.trimEnd().split('\r\n');
    expect(anon).not.toContain('Asha');
    expect(anon).not.toContain('asha@x.in');
    expect(named).toContain('asha@x.in');
    expect(db.user.findMany.mock.calls[0][0].where.id.in).toEqual(['u1']);
  });

  it('exports the raw body only when allowed', async () => {
    db.feedback = { findMany: vi.fn(async () => [fbRow(1)]) };
    expect(await collect(exportChunks({}, {}, true))).toContain('raw body');
    const red = await collect(exportChunks({}, {}, false));
    expect(red).not.toContain('raw body');
    expect(red).toContain('red body');
  });

  it('neutralises formula injection in free text', async () => {
    db.feedback = { findMany: vi.fn(async () => [fbRow(1, { body: '=HYPERLINK("http://evil")' })]) };
    expect(await collect(exportChunks({}, {}, true))).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
