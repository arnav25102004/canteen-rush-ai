import { z } from 'zod';
import { findRecentOrdersForUser } from '../../services/order.service';
import { getRecommendations } from '../../services/recommendation.service';
import { getLoyaltyAccount, getRedemptionTiers } from '../../services/loyalty.service';
import { istDayString, istHHMM } from '../../utils/helpers';
import { defineTool } from './registry';
import { dietCode, hhmm, name, ref, rowsResult } from './common';

export const getMyRecentOrders = defineTool({
  name: 'get_my_recent_orders',
  description: 'The student\'s most recent orders and their items.',
  args: z.object({ n: z.number().int().min(1).max(3).optional() }),
  async run(ctx, a) {
    const orders = await findRecentOrdersForUser(ctx.userId, a.n ?? 3);
    const rows = orders.map((o) => [
      ctx.refs.ref('c', o.canteenId),
      name(o.canteen.name),
      istDayString(0, o.createdAt),
      Number(o.totalAmount),
      o.status,
      o.items.map((i) => [ctx.refs.ref('m', i.menuItemId), name(i.menuItem.name), i.quantity, i.menuItem.isAvailable ? 1 : 0]),
    ]);
    return { data: rowsResult('c,canteen,date,total,status,items[m,name,qty,available]', rows) };
  },
});

export const getRecommendationsTool = defineTool({
  name: 'get_recommendations',
  description: 'Suggest items: the student\'s usual orders, then popular ones.',
  args: z.object({ c: ref.optional(), at: hhmm.optional() }),
  async run(ctx, a) {
    const recs = await getRecommendations({
      userId: ctx.userId,
      institutionId: ctx.institutionId,
      diet: ctx.diet,
      canteenId: a.c ? ctx.refs.resolve(a.c, 'c') : undefined,
      at: a.at ?? istHHMM(ctx.now),
      limit: 5,
    });
    const rows = recs.map((r) => [
      ctx.refs.ref('m', r.id),
      name(r.name),
      r.price,
      dietCode(r),
      r.prepTimeMinutes,
      ctx.refs.ref('c', r.canteenId),
      name(r.canteenName),
      r.reason,
    ]);
    return { data: rowsResult('m,name,price,diet,prep,c,canteen,reason', rows) };
  },
});

export const getMyPoints = defineTool({
  name: 'get_my_points',
  description: 'The student\'s loyalty points balance and redemption tiers.',
  args: z.object({}),
  async run(ctx) {
    const account = await getLoyaltyAccount(ctx.userId);
    return {
      data: {
        points: account?.totalPoints ?? 0,
        tiers: getRedemptionTiers().map((t) => [t.points, t.discount]),
        tierCols: 'points,rupeesOff',
      },
    };
  },
});
