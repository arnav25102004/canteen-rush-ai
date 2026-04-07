import { prisma } from '../config/database';
import { buildDateRange } from '../utils/helpers';
import { OrderStatus } from '@prisma/client';

export async function getVendorSummary(canteenId: string, period: 'today' | 'week' | 'month' = 'today') {
  const now = new Date();
  let start: Date;
  if (period === 'week') {
    start = new Date(now); start.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    start = new Date(now); start.setMonth(now.getMonth() - 1);
  } else {
    start = new Date(now); start.setHours(0, 0, 0, 0);
  }

  const [orders, revenue, avgPrepTime] = await Promise.all([
    prisma.order.count({
      where: { canteenId, createdAt: { gte: start }, status: { not: OrderStatus.CANCELLED } },
    }),
    prisma.order.aggregate({
      where: { canteenId, createdAt: { gte: start }, paymentStatus: 'PAID' },
      _sum: { totalAmount: true },
    }),
    prisma.order.findMany({
      where: { canteenId, actualReadyAt: { not: null }, createdAt: { gte: start } },
      select: { createdAt: true, actualReadyAt: true },
    }),
  ]);

  const avgPrepMinutes = avgPrepTime.length > 0
    ? avgPrepTime.reduce((sum, o) => sum + (o.actualReadyAt!.getTime() - o.createdAt.getTime()) / 60000, 0) / avgPrepTime.length
    : 0;

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
  const orders = await prisma.order.findMany({
    where: { canteenId, status: { not: OrderStatus.CANCELLED } },
    select: { createdAt: true },
  });

  const hourCounts: Record<number, number> = {};
  for (const o of orders) {
    const h = o.createdAt.getHours();
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  }

  return Object.entries(hourCounts)
    .map(([hour, count]) => ({ hour: parseInt(hour), count }))
    .sort((a, b) => a.hour - b.hour);
}

export async function getCanteenRevenue(period: 'today' | 'week' | 'month' = 'week') {
  const now = new Date();
  let start: Date;
  if (period === 'week') {
    start = new Date(now); start.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    start = new Date(now); start.setMonth(now.getMonth() - 1);
  } else {
    start = new Date(now); start.setHours(0, 0, 0, 0);
  }

  const canteens = await prisma.canteen.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const results = await Promise.all(
    canteens.map(async (c) => {
      const [orders, revenue] = await Promise.all([
        prisma.order.count({ where: { canteenId: c.id, createdAt: { gte: start }, status: { not: OrderStatus.CANCELLED } } }),
        prisma.order.aggregate({ where: { canteenId: c.id, createdAt: { gte: start }, paymentStatus: 'PAID' }, _sum: { totalAmount: true } }),
      ]);
      return { id: c.id, name: c.name, orders, revenue: Number(revenue._sum.totalAmount ?? 0) };
    })
  );

  return results;
}

export async function getAdminOverview() {
  const [totalOrders, totalRevenue, canteens] = await Promise.all([
    prisma.order.count({ where: { status: { not: OrderStatus.CANCELLED } } }),
    prisma.order.aggregate({ where: { paymentStatus: 'PAID' }, _sum: { totalAmount: true } }),
    prisma.canteen.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, campus: true,
        _count: { select: { orders: { where: { createdAt: { gte: new Date(Date.now() - 86400000) } } } } },
      },
    }),
  ]);

  return {
    totalOrders,
    totalRevenue: Number(totalRevenue._sum.totalAmount ?? 0),
    activeCanteens: canteens.length,
    canteens,
  };
}
