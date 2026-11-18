import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { getMoodsForCanteens } from '../services/feedbackMood.service';

export async function listInstitutions(req: Request, res: Response) {
  const institutions = await prisma.institution.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, emailDomain: true, logoUrl: true, city: true },
    orderBy: { name: 'asc' },
  });
  return res.json({ institutions });
}

export async function getInstitutionCanteens(req: Request, res: Response) {
  const { id } = req.params;
  const institution = await prisma.institution.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, emailDomain: true, logoUrl: true, city: true },
  });
  if (!institution) return res.status(404).json({ error: 'Institution not found' });

  const canteens = await prisma.canteen.findMany({
    where: { institutionId: id, isActive: true },
    select: {
      id: true, name: true, description: true, campus: true, location: true,
      imageUrl: true, bannerUrl: true, openingTime: true, closingTime: true,
      avgPrepTime: true, contactPhone: true, isActive: true,
      _count: { select: { orders: true } },
    },
    orderBy: { name: 'asc' },
  });
  // One grouped query for every canteen's 7-day mood (additive fields; null until 10+ ratings).
  const moods = await getMoodsForCanteens(canteens.map((c) => c.id));
  return res.json({
    institution,
    canteens: canteens.map((c) => ({
      ...c,
      mood: moods.get(c.id)?.mood ?? null,
      moodCount: moods.get(c.id)?.moodCount ?? 0,
    })),
  });
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
