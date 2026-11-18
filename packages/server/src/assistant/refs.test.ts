import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }));
vi.mock('../config/database', () => ({
  prisma: { assistantConversation: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } },
}));

import { MAX_REFS, RefMap, UNKNOWN_REF_MESSAGE } from './refs';

beforeEach(() => {
  mocks.findFirst.mockReset();
  mocks.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('RefMap', () => {
  it('mints short handles per kind and reuses them', () => {
    const r = new RefMap();
    expect(r.ref('c', 'canteen-a')).toBe('c1');
    expect(r.ref('m', 'item-a')).toBe('m1');
    expect(r.ref('m', 'item-b')).toBe('m2');
    expect(r.ref('m', 'item-a')).toBe('m1');
    expect(r.ref('s', 'slot-a')).toBe('s1');
    expect(r.ref('p', 'prop-a')).toBe('p1');
  });

  it('resolves a handle of the right kind, case-insensitively', () => {
    const r = new RefMap();
    r.ref('m', 'item-a');
    expect(r.resolve('m1', 'm')).toBe('item-a');
    expect(r.resolve(' M1 ', 'm')).toBe('item-a');
  });

  it('an unknown, malformed or wrong-kind handle is "unknown ref; search first"', () => {
    const r = new RefMap();
    r.ref('m', 'item-a');
    for (const [h, k] of [['m9', 'm'], ['c1', 'c'], ['m1', 'c'], ['x1', 'm'], ['', 'm'], ['m01', 'm'], ['item-a', 'm']] as const) {
      expect(() => r.resolve(h, k)).toThrowError(UNKNOWN_REF_MESSAGE);
    }
  });

  it('round-trips through JSON and keeps counters moving forward (append-only)', () => {
    const r = new RefMap();
    r.ref('m', 'a');
    r.ref('m', 'b');
    const again = RefMap.fromJson(r.toJson());
    expect(again.resolve('m2', 'm')).toBe('b');
    expect(again.ref('m', 'c')).toBe('m3');
    expect(again.ref('m', 'a')).toBe('m1');
  });

  it('ignores junk in stored JSON', () => {
    const r = RefMap.fromJson({ m1: 'a', bad: 'x', c2: 5, p1: 'p' });
    expect(r.toJson()).toEqual({ m1: 'a', p1: 'p' });
    expect(RefMap.fromJson(null).size).toBe(0);
    expect(RefMap.fromJson([1, 2]).size).toBe(0);
  });

  it('is capped at 300 refs; existing handles still work at the cap', () => {
    const r = new RefMap();
    for (let i = 0; i < MAX_REFS; i++) r.ref('m', `id-${i}`);
    expect(() => r.ref('m', 'one-too-many')).toThrowError(/too many references/);
    expect(r.ref('m', 'id-5')).toBe('m6');
  });

  it('loads and saves through the owner\'s conversation only', async () => {
    mocks.findFirst.mockResolvedValue({ refs: { m1: 'a' } });
    const r = await RefMap.load('conv', 'user');
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'conv', userId: 'user' } }));
    expect(r.resolve('m1', 'm')).toBe('a');
    await r.save('conv', 'user');
    expect(mocks.updateMany).not.toHaveBeenCalled(); // nothing new
    r.ref('m', 'b');
    await r.save('conv', 'user');
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: 'conv', userId: 'user' }, data: { refs: { m1: 'a', m2: 'b' } } });
  });

  it('loads an empty map for a missing conversation', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await RefMap.load('nope', 'user')).size).toBe(0);
  });
});
