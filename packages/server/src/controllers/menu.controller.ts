import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { uploadImage } from '../config/cloudinary';
import { z } from 'zod';

const categorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int().optional(),
  availableFrom: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  availableTo: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const menuItemSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  imageUrl: z.string().url().optional(),
  isVeg: z.boolean().optional(),
  isJain: z.boolean().optional(),
  containsEgg: z.boolean().optional(),
  prepTimeMinutes: z.number().int().positive().optional(),
  isPopular: z.boolean().optional(),
  isNew: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  customizations: z.array(z.any()).optional(),
});

export async function getCanteenMenu(req: Request, res: Response) {
  const { id: canteenId } = req.params;
  const { diet } = req.query; // "veg", "jain", "noegg"

  const categories = await prisma.menuCategory.findMany({
    where: { canteenId, isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      items: {
        where: {
          isAvailable: true,
          ...(diet === 'veg' ? { isVeg: true } : {}),
          ...(diet === 'jain' ? { isJain: true } : {}),
          ...(diet === 'noegg' ? { containsEgg: false } : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { totalOrders: 'desc' }],
      },
    },
  });

  const popular = await prisma.menuItem.findMany({
    where: { canteenId, isAvailable: true, isPopular: true },
    orderBy: { totalOrders: 'desc' },
    take: 5,
  });

  return res.json({ categories, popular });
}

export async function searchMenuInCanteen(req: Request, res: Response) {
  const { id: canteenId } = req.params;
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query param q required' });

  const items = await prisma.menuItem.findMany({
    where: {
      canteenId,
      isAvailable: true,
      OR: [
        { name: { contains: q as string, mode: 'insensitive' } },
        { description: { contains: q as string, mode: 'insensitive' } },
      ],
    },
    include: { category: { select: { name: true } } },
  });
  return res.json({ items });
}

export async function searchMenuGlobal(req: Request, res: Response) {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query param q required' });

  const items = await prisma.menuItem.findMany({
    where: {
      isAvailable: true,
      OR: [
        { name: { contains: q as string, mode: 'insensitive' } },
        { description: { contains: q as string, mode: 'insensitive' } },
      ],
    },
    include: {
      canteen: { select: { id: true, name: true, campus: true } },
      category: { select: { name: true } },
    },
    orderBy: { totalOrders: 'desc' },
  });
  return res.json({ items });
}

// Category CRUD (vendor)
export async function createCategory(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const parse = categorySchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const category = await prisma.menuCategory.create({
    data: { canteenId, ...parse.data },
  });
  return res.status(201).json({ category });
}

export async function updateCategory(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const parse = categorySchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const category = await prisma.menuCategory.update({ where: { id }, data: parse.data });
  return res.json({ category });
}

export async function deleteCategory(req: AuthRequest, res: Response) {
  const { id } = req.params;
  await prisma.menuCategory.delete({ where: { id } });
  return res.json({ success: true });
}

// Menu item CRUD (vendor)
export async function createMenuItem(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const parse = menuItemSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const { customizations, ...rest } = parse.data;
  const item = await prisma.menuItem.create({
    data: { canteenId, ...rest, customizations: customizations ?? [] },
  });
  return res.status(201).json({ item });
}

export async function updateMenuItem(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const parse = menuItemSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const item = await prisma.menuItem.update({ where: { id }, data: parse.data });
  return res.json({ item });
}

export async function toggleItemAvailability(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const updated = await prisma.menuItem.update({
    where: { id },
    data: { isAvailable: !item.isAvailable },
  });

  // Broadcast availability change to Socket.IO
  if (req.io) {
    req.io.to(`canteen:${item.canteenId}`).emit('item:availability', {
      menuItemId: id,
      isAvailable: updated.isAvailable,
    });
  }

  return res.json({ item: updated });
}

export async function deleteMenuItem(req: AuthRequest, res: Response) {
  const { id } = req.params;
  await prisma.menuItem.delete({ where: { id } });
  return res.json({ success: true });
}

export async function uploadItemImage(req: AuthRequest, res: Response) {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const imageUrl = await uploadImage(req.file.path, 'christ-canteen/menu');
  const item = await prisma.menuItem.update({ where: { id }, data: { imageUrl } });
  return res.json({ item });
}
