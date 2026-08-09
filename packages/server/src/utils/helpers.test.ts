import { describe, it, expect } from 'vitest';
import { generatePickupCode, parsePagination, buildDateRange, generateTimeSlots } from './helpers';

describe('generatePickupCode', () => {
  it('always starts with the CR- prefix', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePickupCode()).toMatch(/^CR-/);
    }
  });

  it('produces a 6-character code from the Crockford-safe alphabet only', () => {
    const code = generatePickupCode().slice(3);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]+$/);
  });

  it('excludes visually ambiguous characters (0, O, 1, I, L, U)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePickupCode();
      expect(code).not.toMatch(/[0OIL1U]/);
    }
  });

  it('has enough entropy that 500 draws do not collide', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generatePickupCode()));
    expect(codes.size).toBe(500);
  });
});

describe('parsePagination', () => {
  it('defaults to page 1, limit 20', () => {
    expect(parsePagination()).toEqual({ skip: 0, take: 20, page: 1, limit: 20 });
  });

  it('computes skip from page and limit', () => {
    expect(parsePagination('3', '10')).toEqual({ skip: 20, take: 10, page: 3, limit: 10 });
  });

  it('clamps page below 1 up to 1', () => {
    expect(parsePagination('0', '20').page).toBe(1);
    expect(parsePagination('-5', '20').page).toBe(1);
  });

  it('clamps limit to the 1..100 range', () => {
    expect(parsePagination('1', '500').limit).toBe(100);
    expect(parsePagination('1', '0').limit).toBe(1);
  });
});

describe('buildDateRange', () => {
  it('returns a full IST day window for a given date string', () => {
    const { gte, lte } = buildDateRange('2026-08-08');
    // IST midnight 2026-08-08 00:00 = 2026-08-07T18:30:00.000Z
    expect(gte.toISOString()).toBe('2026-08-07T18:30:00.000Z');
    // IST 23:59:59.999 = 2026-08-08T18:29:59.999Z
    expect(lte.toISOString()).toBe('2026-08-08T18:29:59.999Z');
  });
});

describe('generateTimeSlots', () => {
  it('generates half-hour slots across a lunch window', () => {
    const slots = generateTimeSlots(12, 0, 13, 0, 30, 10);
    expect(slots).toEqual([
      { startTime: '12:00', endTime: '12:30', maxOrders: 10 },
      { startTime: '12:30', endTime: '13:00', maxOrders: 10 },
      { startTime: '13:00', endTime: '13:30', maxOrders: 10 },
    ]);
  });
});
