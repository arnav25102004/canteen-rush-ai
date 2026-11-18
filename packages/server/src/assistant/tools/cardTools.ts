import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { assertNotStrikeBanned, quoteOrder } from '../../services/order.service';
import { visibleItemWhere } from '../../services/menu.service';
import { buildItemsCard, buildProposalCard } from '../cards';
import { createProposal } from '../proposals';
import { defineTool } from './registry';
import { name, ref } from './common';

/**
 * Terminal. The only write the assistant can make, and only to assistant_proposals. It does not
 * place, pay for or cancel anything: the student confirms at normal checkout.
 */
export const proposeOrder = defineTool({
  name: 'propose_order',
  description: 'Show an order card for the student to review. Does not place the order.',
  terminal: true,
  args: z.object({
    c: ref,
    items: z.array(z.object({ m: ref, qty: z.number().int().min(1).max(10) })).min(1).max(8),
    s: ref.nullable().optional(),
    followups: z.array(z.string().min(1).max(30)).max(2).optional(),
  }),
  async run(ctx, a) {
    const canteenId = ctx.refs.resolve(a.c, 'c');
    const slotId = a.s ? ctx.refs.resolve(a.s, 's') : null;
    // The same item named twice becomes one line.
    const merged = new Map<string, number>();
    for (const it of a.items) {
      const id = ctx.refs.resolve(it.m, 'm');
      merged.set(id, Math.min(10, (merged.get(id) ?? 0) + it.qty));
    }
    await assertNotStrikeBanned(ctx.userId);
    const quote = await quoteOrder({
      userRole: ctx.role,
      institutionId: ctx.institutionId,
      canteenId,
      slotId,
      items: [...merged].map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
    });
    const proposal = await createProposal(ctx, ctx.conversationId, quote);
    const { card, facts } = buildProposalCard(proposal, quote, { diet: ctx.diet });
    return {
      card,
      facts,
      followups: a.followups,
      data: {
        proposal: ctx.refs.ref('p', proposal.id),
        canteen: name(quote.canteen.name),
        items: card.items.map((i) => [name(i.name), i.quantity, i.unitPrice, i.lineTotal]),
        itemCols: 'name,qty,price,line',
        total: card.subtotal,
        slot: card.slot ? `${card.slot.startTime}-${card.slot.endTime}` : null,
        note: 'card shown; student confirms at checkout',
      },
    };
  },
});

/** Terminal. Shows up to 6 items as a card, re-read from the database right now. */
export const showItems = defineTool({
  name: 'show_items',
  description: 'Show a card of up to 6 menu items.',
  terminal: true,
  args: z.object({ ms: z.array(ref).min(1).max(6), title: z.string().max(60).optional() }),
  async run(ctx, a) {
    const ids = [...new Set(a.ms.map((m) => ctx.refs.resolve(m, 'm')))];
    const rows = await prisma.menuItem.findMany({
      where: { id: { in: ids }, ...visibleItemWhere({ institutionId: ctx.institutionId }) },
      include: { canteen: { select: { name: true } } },
    });
    if (rows.length === 0) throw new AppError(404, 'none of those items are available');
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
    const card = buildItemsCard(rows, a.title);
    return {
      card,
      facts: [...card.items.flatMap((i) => [i.name, `${i.price}`, i.canteenName])],
      data: { shown: card.items.length, items: card.items.map((i) => [name(i.name), i.price, name(i.canteenName)]), itemCols: 'name,price,canteen' },
    };
  },
});
