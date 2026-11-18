/**
 * In-memory twins of the eight assistant tools for the hermetic replay. They use the REAL
 * argument schemas, ref handling, name clipping and card builders; only the data source differs
 * (the fixture instead of Postgres). Do not use outside evals.
 */
import { AppError } from '../../src/utils/errors';
import { buildItemsCard, buildProposalCard } from '../../src/assistant/cards';
import { RefMap } from '../../src/assistant/refs';
import type { TurnContext } from '../../src/assistant/context';
import { dietCode, name, rowsResult } from '../../src/assistant/tools/common';
import { createRegistry, defineTool, ToolCtx, ToolDefinition } from '../../src/assistant/tools/registry';
import { ALL_TOOLS } from '../../src/assistant/tools';
import { CANTEENS, FIXTURE_NOW, FxItem, INSTITUTIONS, ITEMS, SLOT_STARTS, slotEnd, slotId } from './fixture';

const canteensA = CANTEENS.filter((c) => c.institution === 'A');
const canteenByName = (n: string) => CANTEENS.find((c) => c.name === n)!;
const visibleItems = ITEMS.filter((i) => canteensA.some((c) => c.name === i.canteen));
const diet = (i: FxItem) => dietCode({ isVeg: i.isVeg, isJain: false, containsEgg: !!i.containsEgg });

const real = (n: string) => ALL_TOOLS.find((t) => t.name === n)!;

export function fixtureContext(refs: RefMap = new RefMap()): TurnContext {
  return {
    userId: 'eval-user',
    institutionId: INSTITUTIONS.A.id,
    institutionName: INSTITUTIONS.A.name,
    role: 'STUDENT' as never,
    diet: null,
    conversationId: null,
    refs,
    now: FIXTURE_NOW,
    canteens: [...canteensA]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ id: c.id, ref: refs.ref('c', c.id), name: c.name, openingTime: c.open, closingTime: c.close, isOpenNow: true })),
  };
}

function rowOf(ctx: ToolCtx, i: FxItem) {
  const c = canteenByName(i.canteen);
  return [ctx.refs.ref('m', i.id), name(i.name), i.price, diet(i), i.prep, ctx.refs.ref('c', c.id), name(c.name)];
}

function tools(): ToolDefinition<any>[] {
  const searchMenu = defineTool({
    ...real('search_menu'),
    args: real('search_menu').args,
    async run(ctx, a: any) {
      const cid = a.c ? ctx.refs.resolve(a.c, 'c') : undefined;
      const words = String(a.q ?? '').toLowerCase().split(/\s+/).map((w) => w.replace(/s$/, '')).filter((w) => w.length >= 2);
      let found = visibleItems.filter((i) => (!cid || canteenByName(i.canteen).id === cid) && words.every((w) => i.name.toLowerCase().includes(w)));
      if (a.maxPrice) found = found.filter((i) => i.price <= a.maxPrice);
      if (a.maxPrep) found = found.filter((i) => i.prep <= a.maxPrep);
      if (a.sort === 'price') found = [...found].sort((x, y) => x.price - y.price);
      else if (a.sort === 'prep') found = [...found].sort((x, y) => x.prep - y.prep);
      else found = [...found].sort((x, y) => Number(!!y.popular) - Number(!!x.popular));
      return { data: rowsResult('m,name,price,diet,prep,c,canteen', found.slice(0, 6).map((i) => rowOf(ctx, i)), found.length) };
    },
  });

  const getCanteenMenu = defineTool({
    ...real('get_canteen_menu'),
    args: real('get_canteen_menu').args,
    async run(ctx, a: any) {
      const cid = ctx.refs.resolve(a.c, 'c');
      const c = canteensA.find((x) => x.id === cid);
      if (!c) throw new AppError(404, 'Canteen not found');
      const rows = visibleItems.filter((i) => i.canteen === c.name).slice(0, 24).map((i) => [ctx.refs.ref('m', i.id), name(i.name), i.price, diet(i), i.prep]);
      return { data: rowsResult('m,name,price,diet,prep', rows, rows.length, { canteen: name(c.name), open: `${c.open}-${c.close}` }) };
    },
  });

  const findSlots = defineTool({
    ...real('find_slots'),
    args: real('find_slots').args,
    async run(ctx, a: any) {
      const cid = ctx.refs.resolve(a.c, 'c');
      const c = canteensA.find((x) => x.id === cid);
      if (!c) throw new AppError(404, 'Canteen not found');
      let list = a.day === 'tomorrow' ? [] : [...SLOT_STARTS];
      if (a.around && !a.earliest) {
        const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
        list = [...list].sort((x, y) => Math.abs(mins(x) - mins(a.around)) - Math.abs(mins(y) - mins(a.around)));
      }
      const picked = list.slice(0, 4).sort();
      const rows = picked.map((s) => [ctx.refs.ref('s', slotId(c.name, s)), s, slotEnd(s), 10]);
      return { data: rowsResult('s,start,end,left', rows, list.length, { day: a.day ?? 'today' }) };
    },
  });

  const none = (n: string) => defineTool({ ...real(n), args: real(n).args, async run() { return { data: { rows: [], found: 0 } }; } });
  const getPoints = defineTool({ ...real('get_my_points'), args: real('get_my_points').args, async run() { return { data: { balance: 120, tiers: [200, 500, 1000] } }; } });
  const recommendations = defineTool({
    ...real('get_recommendations'),
    args: real('get_recommendations').args,
    async run(ctx) {
      const rows = visibleItems.filter((i) => i.popular).slice(0, 5).map((i) => [ctx.refs.ref('m', i.id), name(i.name), i.price, 'popular']);
      return { data: rowsResult('m,name,price,why', rows) };
    },
  });

  const proposeOrder = defineTool({
    ...real('propose_order'),
    args: real('propose_order').args,
    terminal: true,
    async run(ctx, a: any) {
      const cid = ctx.refs.resolve(a.c, 'c');
      const c = canteensA.find((x) => x.id === cid);
      if (!c) throw new AppError(404, 'Canteen not found');
      const merged = new Map<string, number>();
      for (const it of a.items as Array<{ m: string; qty: number }>) {
        const iid = ctx.refs.resolve(it.m, 'm');
        merged.set(iid, Math.min(10, (merged.get(iid) ?? 0) + it.qty));
      }
      const lines = [...merged].map(([iid, quantity]) => {
        const item = ITEMS.find((x) => x.id === iid);
        if (!item || item.canteen !== c.name) throw new AppError(400, 'One or more items are invalid or belong to a different canteen');
        return { menuItemId: iid, name: item.name, isVeg: item.isVeg, quantity, unitPrice: item.price, totalPrice: item.price * quantity, counterUnitPrice: item.price, customizations: {} };
      });
      let slot = null;
      if (a.s) {
        const sid = ctx.refs.resolve(a.s, 's');
        const start = SLOT_STARTS.find((s) => slotId(c.name, s) === sid);
        if (!start) throw new AppError(400, 'This time slot is closed. Please choose another slot.');
        slot = { id: sid, date: new Date('2026-11-18T00:00:00Z'), startTime: start, endTime: slotEnd(start) };
      }
      const quote = {
        canteen: { id: c.id, name: c.name, isActive: true, razorpayAccountId: null, institutionId: INSTITUTIONS.A.id },
        slot,
        slotCap: 25,
        lines,
        subtotal: lines.reduce((s, l) => s + l.totalPrice, 0),
        totalCounterPrice: 0,
      };
      const proposal = { id: `eval-proposal-${merged.size}`, expiresAt: new Date(FIXTURE_NOW.getTime() + 30 * 60_000) };
      const { card, facts } = buildProposalCard(proposal, quote as never, { diet: ctx.diet });
      return {
        card,
        facts,
        followups: a.followups,
        data: {
          proposal: ctx.refs.ref('p', proposal.id),
          canteen: name(c.name),
          items: card.items.map((i) => [name(i.name), i.quantity, i.unitPrice, i.lineTotal]),
          itemCols: 'name,qty,price,line',
          total: card.subtotal,
          slot: card.slot ? `${card.slot.startTime}-${card.slot.endTime}` : null,
          note: 'card shown; student confirms at checkout',
        },
      };
    },
  });

  const showItems = defineTool({
    ...real('show_items'),
    args: real('show_items').args,
    terminal: true,
    async run(ctx, a: any) {
      const ids = [...new Set((a.ms as string[]).map((m) => ctx.refs.resolve(m, 'm')))];
      const rows = ids.map((i) => visibleItems.find((x) => x.id === i)).filter((x): x is FxItem => !!x);
      if (rows.length === 0) throw new AppError(404, 'none of those items are available');
      const card = buildItemsCard(
        rows.map((r) => ({ id: r.id, name: r.name, price: r.price, isVeg: r.isVeg, prepTimeMinutes: r.prep, canteenId: canteenByName(r.canteen).id, canteen: { name: r.canteen } })),
        a.title,
      );
      return {
        card,
        facts: card.items.flatMap((i) => [i.name, `${i.price}`, i.canteenName]),
        data: { shown: card.items.length, items: card.items.map((i) => [name(i.name), i.price, name(i.canteenName)]), itemCols: 'name,price,canteen' },
      };
    },
  });

  return [searchMenu, getCanteenMenu, findSlots, none('get_my_recent_orders'), recommendations, getPoints, proposeOrder, showItems];
}

export const fakeRegistry = createRegistry(tools());

/** Turns a recording placeholder into this run's ref: c = canteen name, m = item name, s = "Canteen HH:MM". */
export function resolveFixtureRef(ctx: TurnContext, kind: string, key: string): string {
  if (kind === 'c') {
    const c = CANTEENS.find((x) => x.name === key);
    if (!c) throw new Error('replay: unknown canteen ' + key);
    return ctx.refs.ref('c', c.id);
  }
  if (kind === 'm') {
    const i = ITEMS.find((x) => x.name === key || x.name.startsWith(key + ' ('));
    if (!i) throw new Error('replay: unknown item ' + key);
    return ctx.refs.ref('m', i.id);
  }
  const m = /^(.*) (\d\d:\d\d)$/.exec(key);
  if (!m) throw new Error('replay: bad slot key ' + key);
  return ctx.refs.ref('s', slotId(m[1], m[2]));
}
