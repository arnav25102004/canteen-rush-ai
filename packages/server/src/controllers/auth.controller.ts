import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { verifyFirebaseToken } from '../config/firebase';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

// ─── Email helpers ─────────────────────────────────────────────────────────────

function isChristEmail(email: string): boolean {
  // Accepts: arnav@mca.christuniversity.in, prof@christuniversity.in
  return /@([\w.-]+\.)?christuniversity\.in$/i.test(email);
}

function extractDepartment(email: string): string | null {
  // arnav@mca.christuniversity.in → "MCA"
  // prof@christuniversity.in → null
  const match = email.match(/@(\w+)\.christuniversity\.in$/i);
  if (match && match[1].toLowerCase() !== 'christuniversity') {
    return match[1].toUpperCase();
  }
  return null;
}

// ─── Dev-mode login (only when Firebase is not configured) ────────────────────
function makeMockToken(uid: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ uid, email, name: uid })).toString('base64');
  return `dev.${payload}.mock`;
}

export async function devLogin(req: Request, res: Response) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not available in production' });
  }

  const { email, name, role } = req.body as { email: string; name?: string; role?: string };
  if (!email) return res.status(400).json({ error: 'email required' });

  if (!isChristEmail(email)) {
    return res.status(400).json({
      error: 'Please use your Christ University email address to register.',
    });
  }

  const firebaseUid = `dev_${email.replace(/[^a-z0-9]/gi, '_')}`;
  const userRole = (role as UserRole) || UserRole.STUDENT;
  const department = extractDepartment(email);

  // Find by firebaseUid first, then fall back to email (handles re-registration)
  let user = await prisma.user.findUnique({
    where: { firebaseUid },
    include: { wallet: true, vendorCanteen: { select: { id: true, name: true } } },
  });

  if (!user) {
    // Check if email already exists with a different uid (e.g. from old seed/register)
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      // Adopt existing account — just update the firebaseUid to the dev format
      user = await prisma.user.update({
        where: { email },
        data: { firebaseUid },
        include: { wallet: true, vendorCanteen: { select: { id: true, name: true } } },
      });
    } else {
      user = await prisma.user.create({
        data: {
          firebaseUid,
          email,
          name: name || email.split('@')[0],
          role: userRole,
          campus: 'Central Campus',
          department,
          wallet: userRole === UserRole.STUDENT || userRole === UserRole.FACULTY
            ? { create: { balance: 0 } }
            : undefined,
        },
        include: { wallet: true, vendorCanteen: { select: { id: true, name: true } } },
      });
    }
  }

  const token = makeMockToken(firebaseUid, email);
  return res.json({ user, token });
}

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

  if (!isChristEmail(email)) {
    return res.status(400).json({
      error: 'Please use your Christ University email address to register.',
    });
  }

  const decoded = await verifyFirebaseToken(firebaseToken);
  if (!decoded) return res.status(401).json({ error: 'Invalid Firebase token' });

  const existing = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
  if (existing) return res.status(409).json({ error: 'User already registered' });

  const department = extractDepartment(email);

  const user = await prisma.user.create({
    data: {
      firebaseUid: decoded.uid,
      email: email || decoded.email || '',
      name,
      role,
      campus,
      phone,
      department,
      wallet: role === UserRole.STUDENT || role === UserRole.FACULTY
        ? { create: { balance: 0 } }
        : undefined,
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
