import { Request, Response } from 'express';
import { prisma } from '../config/database';

export async function listInstitutions(req: Request, res: Response) {
  try {
    const institutions = await prisma.institution.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, emailDomain: true, logoUrl: true, city: true },
      orderBy: { name: 'asc' },
    });
    return res.json({ institutions });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getInstitutionCanteens(req: Request, res: Response) {
  const { id } = req.params;
  try {
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
    return res.json({ institution, canteens });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getInstitutionBySlug(req: Request, res: Response) {
  const { slug } = req.params;
  try {
    const institution = await prisma.institution.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, emailDomain: true, logoUrl: true, city: true },
    });
    if (!institution) return res.status(404).json({ error: 'Institution not found' });
    return res.json({ institution });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
