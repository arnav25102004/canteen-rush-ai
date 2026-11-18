import { describe, it, expect } from 'vitest';
import { EntityDict, CachedEntityDict, type EntityLoader } from './entityDict';

describe('EntityDict', () => {
  const d = new EntityDict(['Veg Puff', 'Puff', 'Christ Bakery', 'Chai', 'Veg Puff', 'ab']);

  it('lowercases, dedupes, drops tiny names and sorts longest first', () => {
    expect(d.names).toEqual(['christ bakery', 'veg puff', 'chai', 'puff']);
  });
  it('finds mentions case-insensitively', () => {
    expect(d.findMentions('One CHAI from Christ Bakery')).toEqual(['christ bakery', 'chai']);
  });
  it('prefers the longest match and does not double count the contained name', () => {
    expect(d.findMentions('2 veg puff please')).toEqual(['veg puff']);
    expect(d.findMentions('veg puff and a puff')).toEqual(['veg puff', 'puff']);
  });
  it('respects word boundaries', () => {
    expect(d.findMentions('chaiwala puffy')).toEqual([]);
    expect(d.findMentions('chai, puff.')).toEqual(['chai', 'puff']);
  });
  it('returns nothing for an empty dictionary or text', () => {
    expect(new EntityDict([]).findMentions('chai')).toEqual([]);
    expect(d.findMentions('')).toEqual([]);
  });
});

describe('CachedEntityDict', () => {
  function make(names: string[][]) {
    let t = 0;
    let calls = 0;
    const loader: EntityLoader = { load: async () => names[Math.min(calls++, names.length - 1)] };
    const c = new CachedEntityDict(loader, () => t);
    return { c, advance: (ms: number) => (t += ms), calls: () => calls };
  }

  it('loads once within the 5 minute TTL', async () => {
    const { c, advance, calls } = make([['chai']]);
    await c.get();
    advance(299_000);
    await c.get();
    expect(calls()).toBe(1);
  });
  it('refreshes after the TTL', async () => {
    const { c, advance, calls } = make([['chai'], ['dosa']]);
    expect((await c.get()).findMentions('chai')).toEqual(['chai']);
    advance(300_001);
    const d2 = await c.get();
    expect(calls()).toBe(2);
    expect(d2.findMentions('dosa')).toEqual(['dosa']);
    expect(d2.findMentions('chai')).toEqual([]);
  });
  it('shares one in-flight load', async () => {
    const { c, calls } = make([['chai']]);
    await Promise.all([c.get(), c.get(), c.get()]);
    expect(calls()).toBe(1);
  });
  it('keeps stale data when a refresh fails, and throws if there is none', async () => {
    let t = 0;
    let fail = false;
    const c = new CachedEntityDict({ load: async () => { if (fail) throw new Error('db'); return ['chai']; } }, () => t);
    await c.get();
    fail = true;
    t += 400_000;
    expect((await c.get()).findMentions('chai')).toEqual(['chai']);
    const c2 = new CachedEntityDict({ load: async () => { throw new Error('db'); } }, () => 0);
    await expect(c2.get()).rejects.toThrow('db');
  });
});
