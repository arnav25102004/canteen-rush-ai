import { OrderQuote } from '../services/order.service';

export interface OrderProposalCard {
  type: 'order_proposal';
  proposalId: string;
  canteen: { id: string; name: string };
  slot: { id: string; date: string; startTime: string; endTime: string } | null;
  items: Array<{ menuItemId: string; name: string; quantity: number; unitPrice: number; lineTotal: number; isVeg: boolean }>;
  subtotal: number;
  expiresAt: string;
  warnings: string[];
}

export interface ItemsCard {
  type: 'items';
  title: string;
  items: Array<{
    menuItemId: string;
    name: string;
    price: number;
    isVeg: boolean;
    prepTimeMinutes: number;
    canteenId: string;
    canteenName: string;
  }>;
}

export type AssistantCard = OrderProposalCard | ItemsCard;

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * The order card. Names, prices and the slot come ONLY from the quote (DB rows), never from
 * model text. Also returns the facts the grounding check lets the reply mention.
 */
export function buildProposalCard(
  proposal: { id: string; expiresAt: Date },
  quote: OrderQuote,
  opts: { diet?: string | null } = {},
): { card: OrderProposalCard; facts: string[] } {
  const warnings: string[] = [];
  if ((opts.diet === 'veg' || opts.diet === 'jain') && quote.lines.some((l) => !l.isVeg)) {
    warnings.push('Contains non-veg items.');
  }
  const slot = quote.slot
    ? { id: quote.slot.id, date: quote.slot.date.toISOString().slice(0, 10), startTime: quote.slot.startTime, endTime: quote.slot.endTime }
    : null;
  const card: OrderProposalCard = {
    type: 'order_proposal',
    proposalId: proposal.id,
    canteen: { id: quote.canteen.id, name: quote.canteen.name },
    slot,
    items: quote.lines.map((l) => ({
      menuItemId: l.menuItemId,
      name: l.name,
      quantity: l.quantity,
      unitPrice: money(l.unitPrice),
      lineTotal: money(l.totalPrice),
      isVeg: l.isVeg,
    })),
    subtotal: money(quote.subtotal),
    expiresAt: proposal.expiresAt.toISOString(),
    warnings,
  };
  const facts = [
    quote.canteen.name,
    ...card.items.flatMap((i) => [i.name, `${i.quantity}`, `${i.unitPrice}`, `${i.lineTotal}`]),
    `${card.subtotal}`,
    ...(slot ? [slot.startTime, slot.endTime] : []),
  ];
  return { card, facts };
}

export interface ItemRow {
  id: string;
  name: string;
  price: unknown;
  isVeg: boolean;
  prepTimeMinutes: number;
  canteenId: string;
  canteen: { name: string };
}

/** The items card, from DB rows only. */
export function buildItemsCard(rows: ItemRow[], title?: string): ItemsCard {
  return {
    type: 'items',
    title: (title ?? '').trim().slice(0, 60) || 'Suggestions',
    items: rows.map((r) => ({
      menuItemId: r.id,
      name: r.name,
      price: money(Number(r.price)),
      isVeg: r.isVeg,
      prepTimeMinutes: r.prepTimeMinutes,
      canteenId: r.canteenId,
      canteenName: r.canteen.name,
    })),
  };
}
