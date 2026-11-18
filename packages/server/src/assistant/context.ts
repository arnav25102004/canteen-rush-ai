import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { isWithinWindow } from '../services/menu.service';
import { istHHMM } from '../utils/helpers';
import { RefMap } from './refs';
import type { ToolCtx } from './tools/registry';

export interface CanteenRow {
  id: string;
  ref: string;
  name: string;
  openingTime: string;
  closingTime: string;
  isOpenNow: boolean;
}

/** Everything one turn knows about the caller. It extends what tools may see. */
export interface TurnContext extends ToolCtx {
  institutionName: string;
  canteens: CanteenRow[];
}

const MAX_CANTEENS = 12;

/**
 * Loads the caller's profile and campus canteens (two queries). The user id comes from
 * the authenticated request; institution, diet and role come from the database.
 */
export async function loadContext(
  reqUser: { id: string },
  opts: { refs?: RefMap; conversationId?: string | null; now?: Date } = {},
): Promise<TurnContext> {
  const now = opts.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: reqUser.id },
    select: { institutionId: true, dietPreference: true, role: true, institution: { select: { name: true } } },
  });
  if (!user || !user.institutionId) throw new AppError(403, 'Your account has no campus set');
  if (user.role !== 'STUDENT' && user.role !== 'FACULTY') throw new AppError(403, 'The assistant is for students and faculty');

  const rows = await prisma.canteen.findMany({
    where: { institutionId: user.institutionId, isActive: true },
    select: { id: true, name: true, openingTime: true, closingTime: true },
    orderBy: { name: 'asc' },
    take: MAX_CANTEENS,
  });
  const refs = opts.refs ?? new RefMap();
  const hhmm = istHHMM(now);
  return {
    userId: reqUser.id,
    institutionId: user.institutionId,
    institutionName: user.institution?.name ?? '',
    role: user.role,
    diet: user.dietPreference ?? null,
    conversationId: opts.conversationId ?? null,
    refs,
    now,
    canteens: rows.map((c) => ({
      id: c.id,
      ref: refs.ref('c', c.id),
      name: c.name,
      openingTime: c.openingTime,
      closingTime: c.closingTime,
      isOpenNow: isWithinWindow(c.openingTime, c.closingTime, hhmm),
    })),
  };
}
