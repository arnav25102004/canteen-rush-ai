import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getVendorSummary, getPopularItems, getPeakHours, getAdminOverview, getCanteenRevenue,
} from '../services/analytics.service';

export async function vendorSummary(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });
  const { period } = req.query as { period?: 'today' | 'week' | 'month' };
  const data = await getVendorSummary(canteenId, period ?? 'today');
  return res.json(data);
}

export async function vendorPopularItems(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });
  const items = await getPopularItems(canteenId);
  return res.json({ items });
}

export async function vendorPeakHours(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });
  const data = await getPeakHours(canteenId);
  return res.json({ peakHours: data });
}

export async function adminOverview(_req: AuthRequest, res: Response) {
  const data = await getAdminOverview();
  return res.json(data);
}

export async function adminCanteenRevenue(req: AuthRequest, res: Response) {
  const { period } = req.query as { period?: 'today' | 'week' | 'month' };
  const canteens = await getCanteenRevenue(period ?? 'week');
  return res.json({ canteens });
}
