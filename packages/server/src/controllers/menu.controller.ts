import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, canteenScope } from '../middleware/auth';
import { uploadImage } from '../config/cloudinary';
import { z } from 'zod';
import fs from 'fs';

const NO_CANTEEN = { error: 'No canteen assigned' };
const NOT_FOUND = { error: 'Not found' };

const categorySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  availableFrom: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  availableTo: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const menuItemSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  price: z.number().positive().max(100000),
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
  if (typeof q !== 'string' || !q || q.length > 100) return res.status(400).json({ error: 'Query param q required (max 100 chars)' });

  const items = await prisma.menuItem.findMany({
    take: 50,
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
  if (typeof q !== 'string' || !q || q.length > 100) return res.status(400).json({ error: 'Query param q required (max 100 chars)' });

  const items = await prisma.menuItem.findMany({
    take: 50,
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

/** Vendor's own full menu, including items marked unavailable (the public menu hides those). */
export async function getMyMenu(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json(NO_CANTEEN);
  const categories = await prisma.menuCategory.findMany({
    where: { canteenId },
    orderBy: { sortOrder: 'asc' },
    include: { items: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
  });
  return res.json({ canteenId, categories });
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
  const scope = canteenScope(req);
  if (!scope) return res.status(403).json(NO_CANTEEN);
  const parse = categorySchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const { count } = await prisma.menuCategory.updateMany({ where: { id, ...scope }, data: parse.data });
  if (count === 0) return res.status(404).json(NOT_FOUND);
  const category = await prisma.menuCategory.findUnique({ where: { id } });
  return res.json({ category });
}

export async function deleteCategory(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const scope = canteenScope(req);
  if (!scope) return res.status(403).json(NO_CANTEEN);
  const { count } = await prisma.menuCategory.deleteMany({ where: { id, ...scope } });
  if (count === 0) return res.status(404).json(NOT_FOUND);
  return res.json({ success: true });
}

// Menu item CRUD (vendor)
export async function createMenuItem(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const parse = menuItemSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const { customizations, ...rest } = parse.data;
  const category = await prisma.menuCategory.findFirst({ where: { id: rest.categoryId, canteenId } });
  if (!category) return res.status(400).json({ error: 'Category does not belong to your canteen' });

  const item = await prisma.menuItem.create({
    data: { canteenId, ...rest, customizations: customizations ?? [] },
  });
  return res.status(201).json({ item });
}

/** The menu item, if the caller may manage it; otherwise sends 403/404 and returns null. */
async function findOwnItem(req: AuthRequest, res: Response) {
  const scope = canteenScope(req);
  if (!scope) { res.status(403).json(NO_CANTEEN); return null; }
  const item = await prisma.menuItem.findFirst({ where: { id: req.params.id, ...scope } });
  if (!item) { res.status(404).json({ error: 'Item not found' }); return null; }
  return item;
}

export async function updateMenuItem(req: AuthRequest, res: Response) {
  const parse = menuItemSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const existing = await findOwnItem(req, res);
  if (!existing) return;

  if (parse.data.categoryId) {
    const category = await prisma.menuCategory.findFirst({ where: { id: parse.data.categoryId, canteenId: existing.canteenId } });
    if (!category) return res.status(400).json({ error: 'Category does not belong to this canteen' });
  }

  const item = await prisma.menuItem.update({ where: { id: existing.id }, data: parse.data });
  return res.json({ item });
}

export async function toggleItemAvailability(req: AuthRequest, res: Response) {
  const item = await findOwnItem(req, res);
  if (!item) return;
  const { id } = item;

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
  const item = await findOwnItem(req, res);
  if (!item) return;
  await prisma.menuItem.delete({ where: { id: item.id } });
  return res.json({ success: true });
}

export async function uploadItemImage(req: AuthRequest, res: Response) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const tmpPath = req.file.path;
  try {
    const existing = await findOwnItem(req, res);
    if (!existing) return;
    const imageUrl = await uploadImage(tmpPath, 'campus-khana/menu');
    const item = await prisma.menuItem.update({ where: { id: existing.id }, data: { imageUrl } });
    return res.json({ item });
  } finally {
    fs.promises.unlink(tmpPath).catch(() => {}); // multer temp file
  }
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export async function getFavorites(req: AuthRequest, res: Response) {
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user!.id },
    include: {
      menuItem: {
        include: { canteen: { select: { id: true, name: true } }, category: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ favorites: favorites.map((f) => f.menuItem) });
}

export async function addFavorite(req: AuthRequest, res: Response) {
  const { menuItemId } = req.params;
  const item = await prisma.menuItem.findUnique({ where: { id: menuItemId } });
  if (!item) return res.status(404).json({ error: 'Menu item not found' });

  try {
    await prisma.favorite.create({ data: { userId: req.user!.id, menuItemId } });
  } catch {
    // Already favorited (unique constraint) — treat as success
  }
  return res.json({ success: true });
}

export async function removeFavorite(req: AuthRequest, res: Response) {
  const { menuItemId } = req.params;
  await prisma.favorite.deleteMany({ where: { userId: req.user!.id, menuItemId } });
  return res.json({ success: true });
}
