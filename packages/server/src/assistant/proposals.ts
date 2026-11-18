import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { OrderQuote, quoteOrder } from '../services/order.service';

export const PROPOSAL_TTL_MS = 30 * 60 * 1000;

export class ProposalError extends AppError {
  constructor(status: number, public readonly code: string, message: string) {
    super(status, message);
    this.name = 'ProposalError';
  }
}

interface StoredItem {
  menuItemId: string;
  quantity: number;
  /** Snapshot at proposal time, only used to report price changes at hand-off. */
  unitPrice?: number;
  name?: string;
}

/**
 * Stores a proposal for a conversation. The student's older open proposals in that
 * conversation become SUPERSEDED, so only the newest card can be handed off.
 */
export async function createProposal(ctx: { userId: string }, conversationId: string | null, quote: OrderQuote) {
  const items: StoredItem[] = quote.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, unitPrice: l.unitPrice, name: l.name }));
  return prisma.$transaction(async (tx) => {
    if (conversationId) {
      await tx.assistantProposal.updateMany({
        where: { userId: ctx.userId, conversationId, status: 'PROPOSED' },
        data: { status: 'SUPERSEDED' },
      });
    }
    return tx.assistantProposal.create({
      data: {
        userId: ctx.userId,
        conversationId,
        canteenId: quote.canteen.id,
        items: items as unknown as Prisma.InputJsonValue,
        subtotal: quote.subtotal,
        slotId: quote.slot?.id ?? null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
      },
    });
  });
}

export interface HandOff {
  canteenId: string;
  canteenName: string;
  items: Array<{ menuItemId: string; name: string; price: number; isVeg: boolean; quantity: number }>;
  slot: { id: string; date: string; startTime: string; endTime: string } | null;
  changes: string[];
}

const rupees = (n: number) => `₹${Math.round(n * 100) / 100}`;

/**
 * Turns a proposal into cart contents for the app. Nothing is ordered here: the student still
 * places and pays at checkout. Prices and availability are re-read now; anything that changed
 * is listed in `changes`.
 */
export async function handOffProposal(userId: string, role: UserRole, proposalId: string, institutionId?: string): Promise<HandOff> {
  const proposal = await prisma.assistantProposal.findFirst({ where: { id: proposalId, userId } });
  if (!proposal) throw new AppError(404, 'Proposal not found');
  const expired = proposal.status === 'EXPIRED' || proposal.status === 'SUPERSEDED' || proposal.expiresAt.getTime() <= Date.now();
  if (expired) {
    if (proposal.status === 'PROPOSED') {
      await prisma.assistantProposal.updateMany({ where: { id: proposal.id, userId, status: 'PROPOSED' }, data: { status: 'EXPIRED' } }).catch(() => undefined);
    }
    throw new ProposalError(410, 'PROPOSAL_EXPIRED', 'This suggestion has expired. Ask the assistant again.');
  }

  const stored = (Array.isArray(proposal.items) ? proposal.items : []) as unknown as StoredItem[];
  const ids = stored.map((i) => i.menuItemId);
  const current = await prisma.menuItem.findMany({
    where: { id: { in: ids }, canteenId: proposal.canteenId },
    select: { id: true, name: true, isAvailable: true },
  });
  const availableIds = new Set(current.filter((m) => m.isAvailable).map((m) => m.id));
  const changes: string[] = [];
  const keep: StoredItem[] = [];
  for (const it of stored) {
    if (availableIds.has(it.menuItemId)) keep.push(it);
    else changes.push(`${it.name ?? current.find((m) => m.id === it.menuItemId)?.name ?? 'An item'} is no longer available`);
  }
  if (keep.length === 0) throw new AppError(409, 'None of the items in this suggestion are available any more');

  const draftItems = keep.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }));
  const base = { userRole: role, canteenId: proposal.canteenId, institutionId, items: draftItems };
  const quote = await quoteOrder({ ...base, slotId: null });

  let slot: HandOff['slot'] = null;
  if (proposal.slotId) {
    try {
      const withSlot = await quoteOrder({ ...base, slotId: proposal.slotId });
      slot = withSlot.slot
        ? { id: withSlot.slot.id, date: withSlot.slot.date.toISOString().slice(0, 10), startTime: withSlot.slot.startTime, endTime: withSlot.slot.endTime }
        : null;
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      changes.push('The pickup slot is no longer available, so no slot is selected');
    }
  }

  for (const line of quote.lines) {
    const before = keep.find((k) => k.menuItemId === line.menuItemId)?.unitPrice;
    if (before !== undefined && Math.abs(before - line.unitPrice) > 0.004) {
      changes.push(`${line.name} price changed from ${rupees(before)} to ${rupees(line.unitPrice)}`);
    }
  }

  const res = await prisma.assistantProposal.updateMany({
    where: { id: proposal.id, userId, status: { in: ['PROPOSED', 'HANDED_OFF'] } },
    data: { status: 'HANDED_OFF', handedOffAt: proposal.handedOffAt ?? new Date() },
  });
  if (res.count === 0) throw new ProposalError(410, 'PROPOSAL_EXPIRED', 'This suggestion has expired. Ask the assistant again.');

  return {
    canteenId: quote.canteen.id,
    canteenName: quote.canteen.name,
    items: quote.lines.map((l) => ({ menuItemId: l.menuItemId, name: l.name, price: l.unitPrice, isVeg: l.isVeg, quantity: l.quantity })),
    slot,
    changes,
  };
}
