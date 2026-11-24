import { prisma } from '../config/database';
import { buildDateRange } from '../utils/helpers';
import { OrderStatus, Prisma } from '@prisma/client';

export async function getVendorSummary(canteenId: string, period: 'today' | 'week' | 'month' = 'today') {
  const now = new Date();
  let start: Date;
  if (period === 'week') {
    start = new Date(now); start.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    start = new Date(now); start.setMonth(now.getMonth() - 1);
  } else {
    start = buildDateRange().gte; // today in IST, whatever the server's timezone
  }

  const [orders, revenue, avgPrep] = await Promise.all([
    prisma.order.count({
      where: { canteenId, createdAt: { gte: start }, status: { not: OrderStatus.CANCELLED } },
    }),
    prisma.order.aggregate({
      where: { canteenId, createdAt: { gte: start }, paymentStatus: 'PAID' },
      _sum: { totalAmount: true },
    }),
    prisma.$queryRaw<Array<{ minutes: number | null }>>(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (actual_ready_at - created_at)) / 60)::float AS minutes
      FROM orders
      WHERE canteen_id = ${canteenId} AND actual_ready_at IS NOT NULL AND created_at >= ${start}`),
  ]);

  const avgPrepMinutes = avgPrep[0]?.minutes ?? 0;

  return {
    period,
    totalOrders: orders,
    totalRevenue: Number(revenue._sum.totalAmount ?? 0),
    avgPrepTimeMinutes: Math.round(avgPrepMinutes),
  };
}

export async function getPopularItems(canteenId: string, limit = 10) {
  return prisma.menuItem.findMany({
    where: { canteenId },
    orderBy: { totalOrders: 'desc' },
    take: limit,
    select: { id: true, name: true, totalOrders: true, avgRating: true, price: true, imageUrl: true },
  });
}

export async function getPeakHours(canteenId: string) {
  // created_at is stored in UTC; peak hours are reported in IST.
  const rows = await prisma.$queryRaw<Array<{ hour: number; count: bigint }>>(Prisma.sql`
    SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::int AS hour, COUNT(*) AS count
    FROM orders
    WHERE canteen_id = ${canteenId} AND status <> 'CANCELLED'
    GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => ({ hour: r.hour, count: Number(r.count) }));
}

export async function getCanteenRevenue(period: 'today' | 'week' | 'month' = 'week') {
  const now = new Date();
  let start: Date;
  if (period === 'week') {
    start = new Date(now); start.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    start = new Date(now); start.setMonth(now.getMonth() - 1);
  } else {
    start = buildDateRange().gte;
  }

  const [canteens, orderCounts, revenue] = await Promise.all([
    prisma.canteen.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.order.groupBy({
      by: ['canteenId'],
      where: { createdAt: { gte: start }, status: { not: OrderStatus.CANCELLED } },
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ['canteenId'],
      where: { createdAt: { gte: start }, paymentStatus: 'PAID' },
      _sum: { totalAmount: true },
    }),
  ]);
  const ordersBy = new Map(orderCounts.map((r) => [r.canteenId, r._count._all]));
  const revenueBy = new Map(revenue.map((r) => [r.canteenId, Number(r._sum.totalAmount ?? 0)]));

  return canteens.map((c) => ({ id: c.id, name: c.name, orders: ordersBy.get(c.id) ?? 0, revenue: revenueBy.get(c.id) ?? 0 }));
}

export async function getAdminOverview() {
  const since = new Date(Date.now() - 86400000);
  const [totalOrders, totalRevenue, canteens, recent] = await Promise.all([
    prisma.order.count({ where: { status: { not: OrderStatus.CANCELLED } } }),
    prisma.order.aggregate({ where: { paymentStatus: 'PAID' }, _sum: { totalAmount: true } }),
    prisma.canteen.findMany({
      where: { isActive: true },
      select: { id: true, name: true, campus: true, isActive: true },
    }),
    prisma.order.groupBy({ by: ['canteenId'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const recentBy = new Map(recent.map((r) => [r.canteenId, r._count._all]));

  return {
    totalOrders,
    totalRevenue: Number(totalRevenue._sum.totalAmount ?? 0),
    activeCanteens: canteens.length,
    canteens: canteens.map((c) => ({ ...c, _count: { orders: recentBy.get(c.id) ?? 0 } })),
  };
}
