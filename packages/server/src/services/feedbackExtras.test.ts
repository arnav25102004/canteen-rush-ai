import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({}));
const cloud: any = vi.hoisted(() => ({ on: true, upload: vi.fn(), destroy: vi.fn() }));
vi.mock('../config/database', () => ({ prisma: db }));
vi.mock('../config/cloudinary', () => ({
  get cloudinaryConfigured() { return cloud.on; },
  uploadBuffer: (...a: any[]) => cloud.upload(...a),
  deleteAsset: (...a: any[]) => cloud.destroy(...a),
}));

import {
  addAttachment, decideAttachment, voteIdea, unvoteIdea, listIdeas, ideaDto, sniffImage, MAX_ATTACHMENT_BYTES,
} from './feedbackExtras.service';
import { runRetention, reconcileAggregates } from './feedbackRetention.service';

const FB = '11111111-1111-4111-8111-111111111111';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const file = (buf = JPEG) => ({ buffer: buf, size: buf.length });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  cloud.on = true;
  cloud.upload.mockReset().mockResolvedValue({ url: 'https://c/x.jpg', publicId: 'p1' });
  cloud.destroy.mockReset().mockResolvedValue(true);
  db.$transaction = async (fn: any) => fn(db);
});

describe('photo attachments', () => {
  function ownFeedback(count = 0) {
    db.feedback = { findFirst: vi.fn(async ({ where }: any) => (where.userId === 'u1' ? { id: FB } : null)) };
    db.feedbackAttachment = { count: vi.fn(async () => count), create: vi.fn(async ({ data }: any) => ({ id: 'a1', ...data })) };
  }

  it('is a 404 for someone else\'s feedback', async () => {
    ownFeedback();
    await expect(addAttachment('u2', FB, file())).rejects.toMatchObject({ status: 404 });
    expect(db.feedback.findFirst.mock.calls[0][0].where).toMatchObject({ id: FB, userId: 'u2', deletedAt: null });
  });

  it('degrades with 200-style result and stores nothing when Cloudinary is off', async () => {
    cloud.on = false;
    ownFeedback();
    const res = await addAttachment('u1', FB, file());
    expect(res).toEqual({ degraded: true, code: 'UPLOADS_UNAVAILABLE' });
    expect(cloud.upload).not.toHaveBeenCalled();
    expect(db.feedbackAttachment.create).not.toHaveBeenCalled();
  });

  it('uploads and stores a PENDING row (admin only until approved)', async () => {
    ownFeedback();
    const res: any = await addAttachment('u1', FB, file());
    expect(res.degraded).toBe(false);
    expect(db.feedbackAttachment.create.mock.calls[0][0].data).toMatchObject({ status: 'PENDING', mimeType: 'image/jpeg', publicId: 'p1', kind: 'PHOTO' });
  });

  it('validates the bytes, not the declared mime type', async () => {
    ownFeedback();
    await expect(addAttachment('u1', FB, file(Buffer.from('<?php echo 1;'))) ).rejects.toMatchObject({ status: 400, code: 'BAD_TYPE' });
    expect(sniffImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(cloud.upload).not.toHaveBeenCalled();
  });

  it('rejects files over 5 MB and missing files', async () => {
    ownFeedback();
    await expect(addAttachment('u1', FB, { buffer: JPEG, size: MAX_ATTACHMENT_BYTES + 1 })).rejects.toMatchObject({ status: 413 });
    await expect(addAttachment('u1', FB, undefined)).rejects.toMatchObject({ status: 400, code: 'NO_FILE' });
  });

  it('allows at most 3 attachments per feedback', async () => {
    ownFeedback(3);
    await expect(addAttachment('u1', FB, file())).rejects.toMatchObject({ status: 409, code: 'TOO_MANY' });
    expect(cloud.upload).not.toHaveBeenCalled();
  });
});

describe('approve and reject', () => {
  function setup(status = 'PENDING') {
    db.feedbackAttachment = {
      findFirst: vi.fn(async () => ({ id: 'a1', feedbackId: FB, publicId: 'p1', status })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    db.feedbackEvent = { create: vi.fn(async () => ({})) };
  }

  it('is scoped by feedbackScope and looks missing when out of scope', async () => {
    setup();
    db.feedbackAttachment.findFirst = vi.fn(async () => null);
    await expect(decideAttachment({ institutionId: 'i1' }, 'a1', 'adm', 'APPROVED')).rejects.toMatchObject({ status: 404 });
    expect(db.feedbackAttachment.findFirst.mock.calls[0][0].where.feedback).toMatchObject({ deletedAt: null, institutionId: 'i1' });
  });

  it('approve writes an event and keeps the asset', async () => {
    setup();
    expect(await decideAttachment({}, 'a1', 'adm', 'APPROVED')).toEqual({ id: 'a1', status: 'APPROVED' });
    expect(db.feedbackEvent.create.mock.calls[0][0].data).toMatchObject({ type: 'attachment_approved', isInternal: true });
    expect(cloud.destroy).not.toHaveBeenCalled();
  });

  it('reject writes an event and deletes the Cloudinary asset', async () => {
    setup();
    await decideAttachment({}, 'a1', 'adm', 'REJECTED');
    expect(db.feedbackEvent.create.mock.calls[0][0].data.type).toBe('attachment_rejected');
    expect(cloud.destroy).toHaveBeenCalledWith('p1');
  });

  it('a failing asset delete does not fail the reject', async () => {
    setup();
    cloud.destroy.mockResolvedValue(false);
    await expect(decideAttachment({}, 'a1', 'adm', 'REJECTED')).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it('a lost race is a 409', async () => {
    setup();
    db.feedbackAttachment.updateMany = vi.fn(async () => ({ count: 0 }));
    await expect(decideAttachment({}, 'a1', 'adm', 'APPROVED')).rejects.toMatchObject({ status: 409 });
  });
});

describe('idea votes', () => {
  function setup(owner = 'author', inserted = 1, deleted = 1) {
    db.feedback = {
      findFirst: vi.fn(async () => ({ id: FB, userId: owner })),
      update: vi.fn(async ({ data }: any) => ({ voteCount: data.voteCount.increment ? 4 : 2 })),
      findUnique: vi.fn(async () => ({ voteCount: 3 })),
    };
    db.$executeRaw = vi.fn(async () => inserted);
    db.feedbackIdeaVote = { deleteMany: vi.fn(async () => ({ count: deleted })) };
  }

  it('cannot vote on your own idea', async () => {
    setup('me');
    await expect(voteIdea('me', 'i1', FB)).rejects.toMatchObject({ status: 400, code: 'OWN_IDEA' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('only votable ideas in the caller\'s institution', async () => {
    setup();
    await voteIdea('u1', 'i1', FB);
    expect(db.feedback.findFirst.mock.calls[0][0].where).toMatchObject({
      kind: 'APP_IDEA', deletedAt: null, institutionId: 'i1', moderation: { not: 'HIDDEN' },
    });
  });

  it('a new vote increments once', async () => {
    setup();
    expect(await voteIdea('u1', 'i1', FB)).toEqual({ voted: true, voteCount: 4 });
    expect(db.feedback.update.mock.calls[0][0].data).toEqual({ voteCount: { increment: 1 } });
  });

  it('a duplicate vote is a no-op: no increment', async () => {
    setup('author', 0);
    expect(await voteIdea('u1', 'i1', FB)).toEqual({ voted: true, voteCount: 3 });
    expect(db.feedback.update).not.toHaveBeenCalled();
  });

  it('removing a vote decrements; removing a missing vote is a no-op', async () => {
    setup();
    expect(await unvoteIdea('u1', 'i1', FB)).toEqual({ voted: false, voteCount: 2 });
    expect(db.feedback.update.mock.calls[0][0].data).toEqual({ voteCount: { decrement: 1 } });
    setup('author', 1, 0);
    expect(await unvoteIdea('u1', 'i1', FB)).toEqual({ voted: false, voteCount: 3 });
    expect(db.feedback.update).not.toHaveBeenCalled();
  });

  it('the idea DTO never carries the author', () => {
    const dto = ideaDto({ id: FB, bodyRedacted: 'dark mode', voteCount: 5, votes: [{ userId: 'u1' }], status: 'SEEN', userId: 'author', createdAt: new Date() }, 'u1');
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'id', 'mine', 'status', 'text', 'voteCount', 'voted']);
    expect(dto).toMatchObject({ text: 'dark mode', voted: true, mine: false });
  });

  it('lists by votes then recency with a cursor, institution scoped', async () => {
    const t = new Date('2026-11-01T00:00:00Z');
    const rows = [1, 2, 3].map((n) => ({ id: `i${n}`, bodyRedacted: `t${n}`, voteCount: 5 - n, status: 'RECEIVED', createdAt: t, userId: 'x', votes: [] }));
    db.feedback = { findMany: vi.fn(async () => rows) };
    const res = await listIdeas('u1', 'i1', 2);
    expect(res.ideas).toHaveLength(2);
    expect(res.nextCursor).toBeTruthy();
    const where = db.feedback.findMany.mock.calls[0][0];
    expect(where.orderBy[0]).toEqual({ voteCount: 'desc' });
    expect(where.where).toMatchObject({ kind: 'APP_IDEA', institutionId: 'i1', deletedAt: null });
    await listIdeas('u1', 'i1', 2, res.nextCursor!);
    expect(db.feedback.findMany.mock.calls[1][0].where.AND[0].OR).toHaveLength(3);
    await expect(listIdeas('u1', 'i1', 2, 'garbage')).rejects.toMatchObject({ status: 400 });
  });
});

describe('retention', () => {
  it('works in small batches and logs counts', async () => {
    const NOW = new Date('2026-11-18T00:00:00Z');
    let ctx = 5;
    db.feedback = {
      findMany: vi.fn(async ({ where, take }: any) => {
        if (where.contextJson) { const n = Math.min(take, ctx); ctx -= n; return Array.from({ length: n }, (_, i) => ({ id: `c${i}` })); }
        return [];
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    const counts = await runRetention(NOW, 2);
    expect(counts.contextCleared).toBe(5);
    const takes = db.feedback.findMany.mock.calls.filter((c: any) => c[0].where.contextJson).map((c: any) => c[0].take);
    expect(takes.every((t: number) => t === 2)).toBe(true);
    expect(db.feedback.updateMany).toHaveBeenCalledTimes(3);
  });

  it('clears text and attachments after 24 months, keeping rating fields untouched', async () => {
    const NOW = new Date('2026-11-18T00:00:00Z');
    let served = false;
    db.feedback = {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.OR && !served) { served = true; return [{ id: 'f1', attachments: [{ id: 'a', publicId: 'p1' }] }]; }
        return [];
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    db.feedbackAttachment = { deleteMany: vi.fn(async () => ({ count: 1 })) };
    const counts = await runRetention(NOW, 10);
    expect(counts).toMatchObject({ bodiesCleared: 1, attachmentsDeleted: 1 });
    expect(cloud.destroy).toHaveBeenCalledWith('p1');
    expect(db.feedback.updateMany.mock.calls[0][0].data).toEqual({ body: null, bodyRedacted: null });
    const cutoff: Date = db.feedback.findMany.mock.calls.find((c: any) => c[0].where.OR)[0].where.createdAt.lt;
    expect(cutoff.getFullYear()).toBe(2024);
  });

  it('purges soft-deleted rows with their ratings in one transaction', async () => {
    const NOW = new Date('2026-11-18T00:00:00Z');
    let served = false;
    db.feedback = {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.deletedAt && !served) { served = true; return [{ id: 'f1', attachments: [] }]; }
        return [];
      }),
      updateMany: vi.fn(), deleteMany: vi.fn(async () => ({ count: 1 })),
    };
    db.rating = { deleteMany: vi.fn(async () => ({ count: 2 })) };
    db.feedbackEvent = { deleteMany: vi.fn(async () => ({ count: 1 })) };
    db.feedbackReport = { deleteMany: vi.fn(async () => ({ count: 0 })) };
    const counts = await runRetention(NOW, 10);
    expect(counts.purged).toBe(1);
    expect(db.rating.deleteMany).toHaveBeenCalled();
    const cut = db.feedback.deleteMany.mock.calls[0][0].where.deletedAt.lt as Date;
    expect(NOW.getTime() - cut.getTime()).toBe(30 * 24 * 3600 * 1000);
  });
});

describe('reconcile', () => {
  it('writes only rows that differ and warns on drift', async () => {
    db.rating = { groupBy: vi.fn(async () => [{ menuItemId: 'm1', _sum: { rating: 9 }, _count: { _all: 2 } }, { menuItemId: 'm2', _sum: { rating: 4 }, _count: { _all: 1 } }]) };
    db.feedback = { groupBy: vi.fn(async () => [{ canteenId: 'c1', _sum: { overallRating: 8 }, _count: { _all: 2 } }]) };
    db.menuItem = {
      findMany: vi.fn(async () => [
        { id: 'm1', ratingSum: 9, totalRatings: 2, avgRating: 4.5 }, // correct (4.5)
        { id: 'm2', ratingSum: 5, totalRatings: 1, avgRating: 5 }, // drifted
        { id: 'm3', ratingSum: 3, totalRatings: 1, avgRating: 3 }, // no live ratings: reset to 0
        { id: 'm4', ratingSum: 0, totalRatings: 0, avgRating: 0 }, // correct
      ]),
      update: vi.fn(async () => ({})),
    };
    db.canteen = { findMany: vi.fn(async () => [{ id: 'c1', ratingSum: 8, totalRatings: 2, avgRating: 4 }]), update: vi.fn() };
    const res = await reconcileAggregates();
    expect(res).toMatchObject({ itemsFixed: 2, canteensFixed: 0 });
    expect(db.menuItem.update.mock.calls.map((c: any) => c[0].where.id).sort()).toEqual(['m2', 'm3']);
    expect(db.menuItem.update.mock.calls.find((c: any) => c[0].where.id === 'm3')[0].data).toEqual({ ratingSum: 0, totalRatings: 0, avgRating: 0 });
    expect(db.canteen.update).not.toHaveBeenCalled();
    // hidden and deleted feedback are excluded from the source rows
    expect(db.rating.groupBy.mock.calls[0][0].where.feedback).toMatchObject({ deletedAt: null, moderation: { not: 'HIDDEN' } });
  });
});
