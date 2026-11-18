import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { istDayString } from '../../utils/helpers';
import { isWithinWindow } from '../../services/menu.service';
import { listSlotsWithAvailability } from '../../services/slot.service';
import { defineTool } from './registry';
import { hhmm, parseHHMMToMinutes, ref, rowsResult } from './common';

const MAX_SLOTS = 4;

export const findSlots = defineTool({
  name: 'find_slots',
  description: 'Find open pickup slots for a canteen, today or tomorrow.',
  args: z.object({
    c: ref,
    day: z.enum(['today', 'tomorrow']).optional(),
    around: hhmm.optional(),
    earliest: z.boolean().optional(),
  }),
  async run(ctx, a) {
    const canteenId = ctx.refs.resolve(a.c, 'c');
    const canteen = await prisma.canteen.findFirst({
      where: { id: canteenId, institutionId: ctx.institutionId, isActive: true },
      select: { openingTime: true, closingTime: true },
    });
    if (!canteen) throw new AppError(404, 'Canteen not found');
    const day = istDayString(a.day === 'tomorrow' ? 1 : 0, ctx.now);
    const { slots } = await listSlotsWithAvailability(canteenId, day, ctx.role, ctx.now.getTime());
    // Only slots a student could actually book: open, not full, before the cutoff, inside canteen hours.
    let usable = slots.filter(
      (s) => s.isOpen && !s.isFull && s.available > 0 && !s.isCutoffPassed && isWithinWindow(canteen.openingTime, canteen.closingTime, s.startTime),
    );
    if (a.around && !a.earliest) {
      const target = parseHHMMToMinutes(a.around);
      usable = [...usable].sort((x, y) => Math.abs(parseHHMMToMinutes(x.startTime) - target) - Math.abs(parseHHMMToMinutes(y.startTime) - target));
    }
    const picked = usable.slice(0, MAX_SLOTS).sort((x, y) => x.startTime.localeCompare(y.startTime));
    const rows = picked.map((s) => [ctx.refs.ref('s', s.slotId), s.startTime, s.endTime, s.available]);
    return { data: rowsResult('s,start,end,left', rows, usable.length, { day: a.day ?? 'today' }) };
  },
});
