import { z } from 'zod';
import { searchMenuItems } from '../../services/menu.service';
import { istHHMM } from '../../utils/helpers';
import { defineTool } from './registry';
import { dietCode, hhmm, name, ref, rowsResult } from './common';

const LIMIT = 6;

export const searchMenu = defineTool({
  name: 'search_menu',
  description: 'Search available menu items at the student\'s campus canteens.',
  args: z.object({
    q: z.string().max(60).optional(),
    c: ref.optional(),
    maxPrice: z.number().positive().max(10000).optional(),
    maxPrep: z.number().int().positive().max(240).optional(),
    anyDiet: z.boolean().optional(),
    sort: z.enum(['pop', 'price', 'prep']).optional(),
    at: hhmm.optional(),
  }),
  async run(ctx, a) {
    const canteenId = a.c ? ctx.refs.resolve(a.c, 'c') : undefined;
    const found = await searchMenuItems({
      institutionId: ctx.institutionId,
      canteenId,
      text: a.q,
      diet: a.anyDiet ? null : ctx.diet,
      maxPrice: a.maxPrice,
      maxPrepMinutes: a.maxPrep,
      at: a.at ?? istHHMM(ctx.now),
      sort: a.sort === 'price' ? 'price_asc' : a.sort === 'prep' ? 'prep_asc' : 'popular',
      limit: LIMIT + 2,
    });
    const rows = found.slice(0, LIMIT).map((i) => [
      ctx.refs.ref('m', i.id),
      name(i.name),
      i.price,
      dietCode(i),
      i.prepTimeMinutes,
      ctx.refs.ref('c', i.canteenId),
      name(i.canteenName),
    ]);
    return { data: rowsResult('m,name,price,diet,prep,c,canteen', rows, found.length) };
  },
});
