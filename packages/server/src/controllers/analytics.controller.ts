import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { cached } from '../config/cache';
import {
  getVendorSummary, getPopularItems, getPeakHours, getAdminOverview, getCanteenRevenue,
} from '../services/analytics.service';

type Period = 'today' | 'week' | 'month';
const parsePeriod = (value: unknown, fallback: Period): Period =>
  value === 'today' || value === 'week' || value === 'month' ? value : fallback;

export async function vendorSummary(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });
  const period = parsePeriod(req.query.period, 'today');
  const data = await cached(`analytics:summary:${canteenId}:${period}`, () => getVendorSummary(canteenId, period), { ttl: 5, stale: 30 });
  return res.json(data);
}

export async function vendorPopularItems(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });
  const items = await cached(`analytics:popular:${canteenId}`, () => getPopularItems(canteenId), { ttl: 30, stale: 120 });
  return res.json({ items });
}

export async function vendorPeakHours(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });
  const data = await cached(`analytics:peak:${canteenId}`, () => getPeakHours(canteenId), { ttl: 60, stale: 300 });
  return res.json({ peakHours: data });
}

export async function adminOverview(_req: AuthRequest, res: Response) {
  const data = await cached('analytics:overview', getAdminOverview, { ttl: 15, stale: 120 });
  return res.json(data);
}

export async function adminCanteenRevenue(req: AuthRequest, res: Response) {
  const period = parsePeriod(req.query.period, 'week');
  const canteens = await cached(`analytics:revenue:${period}`, () => getCanteenRevenue(period), { ttl: 15, stale: 120 });
  return res.json({ canteens });
}
