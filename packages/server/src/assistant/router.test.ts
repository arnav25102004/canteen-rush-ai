import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/database', () => ({ prisma: {} }));
vi.mock('../services/slot.service', () => ({ listSlotsWithAvailability: vi.fn() }));
vi.mock('../services/order.service', () => ({ quoteOrder: vi.fn(), assertNotStrikeBanned: vi.fn(), findRecentOrdersForUser: vi.fn() }));
vi.mock('../services/loyalty.service', () => ({ getLoyaltyAccount: vi.fn(), getRedemptionTiers: () => [] }));
vi.mock('../services/recommendation.service', () => ({ getRecommendations: vi.fn() }));
vi.mock('./proposals', () => ({ createProposal: vi.fn() }));

import { selectTools } from './router';
import type { AssistantCard } from './cards';

const names = (text: string, card?: AssistantCard | null) => selectTools(text, card).map((t) => t.name);

const orderCard = { type: 'order_proposal' } as AssistantCard;
const itemsCard = { type: 'items' } as AssistantCard;

describe('selectTools', () => {
  it('offers the order set for ordering sentences (English and Hinglish)', () => {
    const set = ['search_menu', 'find_slots', 'propose_order', 'get_canteen_menu'];
    expect(names('2 veg puffs for 1pm from Christ Bakery')).toEqual(set);
    expect(names('I want a chai')).toEqual(set);
    expect(names('ek samosa chahiye 3 baje')).toEqual(set);
    expect(names('2 chai dena')).toEqual(set);
  });

  it('offers the browse set for suggestions and questions', () => {
    const set = ['search_menu', 'get_recommendations', 'show_items', 'get_canteen_menu'];
    expect(names('something veg under 80')).toEqual(set);
    expect(names('kya milega abhi')).toEqual(set);
    expect(names('what is popular')).toEqual(set);
  });

  it('offers recent orders for status and repeat requests', () => {
    expect(names('my last order')).toEqual(['get_my_recent_orders', 'find_slots', 'propose_order', 'search_menu']);
    expect(names('pichla order dobara')).toContain('get_my_recent_orders');
    expect(names('same as last time')).toContain('get_my_recent_orders');
  });

  it('offers only the points tools for points questions', () => {
    expect(names('how many points do I have')).toEqual(['get_my_points', 'get_recommendations']);
    expect(names('mere points kitne hain')).toEqual(['get_my_points', 'get_recommendations']);
  });

  it('uses the last card for short follow-ups', () => {
    expect(names('make it 3', orderCard)).toEqual(['find_slots', 'propose_order', 'search_menu']);
    expect(names('the second one', itemsCard)).toEqual(['propose_order', 'find_slots', 'search_menu', 'show_items']);
  });

  it('falls back to the default set and never offers more than 4 tools', () => {
    expect(names('hello')).toEqual(['search_menu', 'get_canteen_menu', 'get_recommendations', 'show_items']);
    for (const t of ['hi', '2 veg puffs', 'points', 'last order', 'menu', 'x'.repeat(50)]) {
      expect(selectTools(t, orderCard).length).toBeLessThanOrEqual(4);
    }
  });

  it('never offers a tool that can place, pay or cancel', () => {
    for (const t of ['order now', 'pay', 'cancel my order', 'hello', 'points']) {
      for (const n of names(t)) expect(n).not.toMatch(/place|pay|cancel|wallet/);
    }
  });
});
