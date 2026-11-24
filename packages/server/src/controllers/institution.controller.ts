import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { cached, sendCachedJson } from '../config/cache';
import { activeOrderCounts, institutionCanteensKey } from '../services/catalogCache.service';
import { getMoodsForCanteens } from '../services/feedbackMood.service';

export async function listInstitutions(_req: Request, res: Response) {
  const institutions = await prisma.institution.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, emailDomain: true, logoUrl: true, city: true },
    orderBy: { name: 'asc' },
  });
  return res.json({ institutions });
}

export async function getInstitutionCanteens(req: Request, res: Response) {
  const { id } = req.params;
  const body = await cached(institutionCanteensKey(id), async () => {
    const institution = await prisma.institution.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, emailDomain: true, logoUrl: true, city: true },
    });
    if (!institution) return null;

    const canteens = await prisma.canteen.findMany({
      where: { institutionId: id, isActive: true },
      select: {
        id: true, name: true, description: true, campus: true, location: true,
        imageUrl: true, bannerUrl: true, openingTime: true, closingTime: true,
        avgPrepTime: true, contactPhone: true, isActive: true,
      },
      orderBy: { name: 'asc' },
    });
    const ids = canteens.map((c) => c.id);
    // One grouped query each for active orders and 7-day mood (null until 10+ ratings).
    const [activeOrders, moods] = await Promise.all([activeOrderCounts(ids), getMoodsForCanteens(ids)]);
    return {
      institution,
      canteens: canteens.map((c) => ({
        ...c,
        _count: { orders: activeOrders.get(c.id) ?? 0 },
        mood: moods.get(c.id)?.mood ?? null,
        moodCount: moods.get(c.id)?.moodCount ?? 0,
      })),
    };
  }, { ttl: 10, stale: 60, cacheIf: (b) => !!b });
  if (!body) return res.status(404).json({ error: 'Institution not found' });
  return sendCachedJson(req, res, body, 'public, max-age=0, s-maxage=5, stale-while-revalidate=10');
}

export async function getInstitutionBySlug(req: Request, res: Response) {
  const { slug } = req.params;
  const institution = await prisma.institution.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, emailDomain: true, logoUrl: true, city: true },
  });
  if (!institution) return res.status(404).json({ error: 'Institution not found' });
  return res.json({ institution });
}
