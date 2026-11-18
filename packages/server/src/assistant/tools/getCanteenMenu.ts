import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { getCanteenMenuData, isWithinWindow } from '../../services/menu.service';
import { istHHMM } from '../../utils/helpers';
import { defineTool } from './registry';
import { dietCode, hhmm, name, ref, rowsResult } from './common';

const MAX_ITEMS = 24;

export const getCanteenMenu = defineTool({
  name: 'get_canteen_menu',
  description: 'List available items of one canteen.',
  args: z.object({ c: ref, at: hhmm.optional() }),
  async run(ctx, a) {
    const canteenId = ctx.refs.resolve(a.c, 'c');
    const canteen = await prisma.canteen.findFirst({
      where: { id: canteenId, institutionId: ctx.institutionId, isActive: true },
      select: { id: true, name: true, openingTime: true, closingTime: true },
    });
    if (!canteen) throw new AppError(404, 'Canteen not found');
    const at = a.at ?? istHHMM(ctx.now);
    const { categories } = await getCanteenMenuData(canteenId, ctx.diet);
    const items = categories
      .filter((c) => isWithinWindow(c.availableFrom, c.availableTo, at))
      .flatMap((c) => c.items);
    const rows = items.slice(0, MAX_ITEMS).map((i) => [ctx.refs.ref('m', i.id), name(i.name), Number(i.price), dietCode(i), i.prepTimeMinutes]);
    const result = rowsResult('m,name,price,diet,prep', rows, items.length, { canteen: name(canteen.name), open: `${canteen.openingTime}-${canteen.closingTime}` });
    // This tool may list more than the 8 rows search returns; keep the full 24.
    if (rows.length > 0) Object.assign(result, { rows, more: Math.max(0, items.length - rows.length) });
    return { data: result };
  },
  maxResultBytes: 4096,
});
