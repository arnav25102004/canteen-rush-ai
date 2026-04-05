import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { verifyFirebaseToken } from '../config/firebase';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

const registerSchema = z.object({
  firebaseToken: z.string(),
  name: z.string().min(2),
  email: z.string().email(),
  role: z.nativeEnum(UserRole).optional().default(UserRole.STUDENT),
  campus: z.string().optional(),
  phone: z.string().optional(),
});

const updateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  campus: z.string().optional(),
  dietPreference: z.enum(['veg', 'nonveg', 'jain', 'noegg']).optional(),
  avatarUrl: z.string().url().optional(),
});

export async function register(req: Request, res: Response) {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const { firebaseToken, name, email, role, campus, phone } = parse.data;

  const decoded = await verifyFirebaseToken(firebaseToken);
  if (!decoded) return res.status(401).json({ error: 'Invalid Firebase token' });

  const existing = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
  if (existing) return res.status(409).json({ error: 'User already registered' });

  const user = await prisma.user.create({
    data: {
      firebaseUid: decoded.uid,
      email: email || decoded.email || '',
      name,
      role,
      campus,
      phone,
      wallet: role === UserRole.STUDENT ? { create: { balance: 0 } } : undefined,
    },
    include: { wallet: true },
  });

  return res.status(201).json({ user });
}

export async function getMe(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      wallet: { select: { balance: true } },
      vendorCanteen: { select: { id: true, name: true } },
    },
  });
  return res.json({ user });
}

export async function updateMe(req: AuthRequest, res: Response) {
  const parse = updateProfileSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: parse.data,
  });
  return res.json({ user });
}

export async function saveFcmToken(req: AuthRequest, res: Response) {
  const { fcmToken } = req.body;
  if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { fcmToken },
  });
  return res.json({ success: true });
}
