import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { istDayString, istHHMM } from '../utils/helpers';
import { isWithinWindow, searchMenuItems } from '../services/menu.service';
import { listSlotsWithAvailability } from '../services/slot.service';
import { assertNotStrikeBanned, findRecentOrdersForUser, quoteOrder } from '../services/order.service';
import { AssistantCard, buildItemsCard, buildProposalCard } from './cards';
import { TurnContext } from './context';
import { createProposal } from './proposals';
import { TurnAction } from './chips';

export interface ChipActionResult {
  text: string;
  cards: AssistantCard[];
  outcome: 'chip';
}

type Item = { menuItemId: string; quantity: number };

const result = (text: string, cards: AssistantCard[] = []): ChipActionResult => ({ text, cards, outcome: 'chip' });

/** The conversation's newest open order card, if it is still valid. */
async function openProposal(ctx: TurnContext, conversationId: string) {
  const p = await prisma.assistantProposal.findFirst({
    where: { conversationId, userId: ctx.userId, status: 'PROPOSED', expiresAt: { gt: ctx.now } },
    orderBy: { createdAt: 'desc' },
  });
  if (!p) return null;
  const items = (Array.isArray(p.items) ? p.items : []) as unknown as Array<Item & { unitPrice?: number }>;
  return { canteenId: p.canteenId, slotId: p.slotId, items: items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })) };
}

async function proposeCard(ctx: TurnContext, conversationId: string, draft: { canteenId: string; slotId: string | null; items: Item[] }) {
  await assertNotStrikeBanned(ctx.userId);
  const quote = await quoteOrder({ userRole: ctx.role, institutionId: ctx.institutionId, ...draft });
  const proposal = await createProposal(ctx, conversationId, quote);
  return buildProposalCard(proposal, quote, { diet: ctx.diet }).card;
}

const DRINK_WORDS = 'tea coffee chai juice drink shake lassi cola';

/**
 * Runs a chip in code. It never touches the model provider, so it costs zero tokens. Reasons it
 * cannot do something come back as short fixed texts; AppErrors (safe messages) are passed on.
 */
export async function runChipAction(ctx: TurnContext, conv: { id: string }, action: TurnAction): Promise<ChipActionResult> {
  try {
    switch (action.type) {
      case 'reorder_last': {
        const [last] = await findRecentOrdersForUser(ctx.userId, 1);
        if (!last) return result("You haven't ordered yet. Tell me what you'd like.");
        const items = last.items.filter((i) => i.menuItem.isAvailable).map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }));
        if (items.length === 0) return result('Those items are not available right now.');
        const card = await proposeCard(ctx, conv.id, { canteenId: last.canteenId, slotId: null, items });
        return result("Here's your usual order, review it and checkout.", [card]);
      }
      case 'earliest_slot': {
        const open = await openProposal(ctx, conv.id);
        if (!open) return result('Pick your items first, then I can find a slot.');
        const canteen = ctx.canteens.find((c) => c.id === open.canteenId);
        for (const offset of [0, 1]) {
          const day = istDayString(offset, ctx.now);
          const { slots } = await listSlotsWithAvailability(open.canteenId, day, ctx.role, ctx.now.getTime());
          const usable = slots
            .filter((s) => s.isOpen && !s.isFull && s.available > 0 && !s.isCutoffPassed && (!canteen || isWithinWindow(canteen.openingTime, canteen.closingTime, s.startTime)))
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
          if (usable.length === 0) continue;
          const slot = usable[0];
          const card = await proposeCard(ctx, conv.id, { canteenId: open.canteenId, slotId: slot.slotId, items: open.items });
          return result(`Earliest slot is ${slot.startTime}${offset ? ' tomorrow' : ''}. Review your order.`, [card]);
        }
        return result('No open pickup slots are left right now.');
      }
      case 'add_drink': {
        const open = await openProposal(ctx, conv.id);
        if (!open) return result('Pick your items first, then I can add a drink.');
        const have = new Set(open.items.map((i) => i.menuItemId));
        const drinks = await searchMenuItems({
          institutionId: ctx.institutionId,
          canteenId: open.canteenId,
          text: DRINK_WORDS,
          diet: ctx.diet,
          at: istHHMM(ctx.now),
          sort: 'popular',
          limit: 8,
        });
        const drink = drinks.find((d) => !have.has(d.id));
        if (!drink) return result('No drinks are available at this canteen right now.');
        const card = await proposeCard(ctx, conv.id, {
          canteenId: open.canteenId,
          slotId: open.slotId,
          items: [...open.items, { menuItemId: drink.id, quantity: 1 }],
        });
        return result(`Added ${drink.name}. Review your order.`, [card]);
      }
      case 'popular_now': {
        const rows = await searchMenuItems({
          institutionId: ctx.institutionId,
          diet: ctx.diet,
          at: istHHMM(ctx.now),
          sort: 'popular',
          limit: 5,
        });
        if (rows.length === 0) return result('Nothing popular is available right now.');
        const card = buildItemsCard(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            price: r.price,
            isVeg: r.isVeg,
            prepTimeMinutes: r.prepTimeMinutes,
            canteenId: r.canteenId,
            canteen: { name: r.canteenName },
          })),
          'Popular now',
        );
        return result('Popular right now at your canteens:', [card]);
      }
    }
  } catch (err) {
    if (err instanceof AppError && err.status < 500) return result(err.message);
    throw err;
  }
}
