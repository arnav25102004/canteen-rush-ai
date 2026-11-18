import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database', () => ({ prisma: {} }));

import { dietWhere, isWithinWindow } from './menu.service';
import { istHHMM, istDayString } from '../utils/helpers';

describe('dietWhere', () => {
  it('maps each diet to its filter', () => {
    expect(dietWhere('veg')).toEqual({ isVeg: true });
    expect(dietWhere('jain')).toEqual({ isJain: true });
    expect(dietWhere('noegg')).toEqual({ containsEgg: false });
  });
  it('returns no filter for nonveg, unknown or empty values', () => {
    expect(dietWhere('nonveg')).toEqual({});
    expect(dietWhere(undefined)).toEqual({});
    expect(dietWhere(null)).toEqual({});
  });
});

describe('isWithinWindow', () => {
  it('is open all day without bounds', () => {
    expect(isWithinWindow(null, null, '03:00')).toBe(true);
  });
  it('handles a same-day window inclusively', () => {
    expect(isWithinWindow('08:00', '11:00', '08:00')).toBe(true);
    expect(isWithinWindow('08:00', '11:00', '11:00')).toBe(true);
    expect(isWithinWindow('08:00', '11:00', '07:59')).toBe(false);
    expect(isWithinWindow('08:00', '11:00', '11:01')).toBe(false);
  });
  it('handles a window that crosses midnight', () => {
    expect(isWithinWindow('22:00', '02:00', '23:30')).toBe(true);
    expect(isWithinWindow('22:00', '02:00', '01:00')).toBe(true);
    expect(isWithinWindow('22:00', '02:00', '12:00')).toBe(false);
  });
  it('treats a single bound as open-ended', () => {
    expect(isWithinWindow('12:00', null, '15:00')).toBe(true);
    expect(isWithinWindow('12:00', null, '11:00')).toBe(false);
    expect(isWithinWindow(null, '12:00', '11:00')).toBe(true);
    expect(isWithinWindow(null, '12:00', '13:00')).toBe(false);
  });
});

describe('IST helpers', () => {
  it('formats the IST wall clock', () => {
    // 2026-11-18T07:30:00Z = 13:00 IST
    expect(istHHMM(new Date('2026-11-18T07:30:00Z'))).toBe('13:00');
  });
  it('rolls into the next IST day late in the UTC evening', () => {
    // 2026-11-18T20:00:00Z = 2026-11-19 01:30 IST
    const at = new Date('2026-11-18T20:00:00Z');
    expect(istDayString(0, at)).toBe('2026-11-19');
    expect(istDayString(1, at)).toBe('2026-11-20');
  });
});
