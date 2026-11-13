import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { verifyFirebaseToken, devAuthEnabled } from '../config/firebase';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

// ─── Email helpers ─────────────────────────────────────────────────────────────

function extractEmailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

function extractDepartment(email: string): string | null {
  // arnav@mca.christuniversity.in → "MCA"
  const match = email.match(/@(\w+)\.[\w.]+$/i);
  if (match && match[1].length <= 10) return match[1].toUpperCase();
  return null;
}

async function findInstitutionByEmail(email: string) {
  const emailDomain = extractEmailDomain(email);
  if (!emailDomain) return null;
  // Match exact domain or parent domain (e.g. mca.christuniversity.in → christuniversity.in)
  const parts = emailDomain.split('.');
  const domainsToTry: string[] = [emailDomain];
  if (parts.length > 2) domainsToTry.push(parts.slice(-2).join('.'));

  return prisma.institution.findFirst({
    where: { emailDomain: { in: domainsToTry }, isActive: true },
  });
}

/**
 * Role for a brand-new account. Never taken from the client: everyone starts
 * as STUDENT except emails listed in ADMIN_EMAILS (comma-separated). Vendors
 * are promoted by an admin from the admin Users page.
 */
export function initialRoleFor(email: string): UserRole {
  const admins = (process.env.ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase()) ? UserRole.ADMIN : UserRole.STUDENT;
}

// ─── Dev-mode login (local only: NODE_ENV!=production AND DEV_AUTH=true) ──────
function makeMockToken(uid: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ uid, email, name: uid })).toString('base64');
  return `dev.${payload}.mock`;
}

export async function devLogin(req: Request, res: Response) {
  if (!devAuthEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { email, name, role } = req.body as { email: string; name?: string; role?: string };
  if (!email) return res.status(400).json({ error: 'email required' });

  const institution = await findInstitutionByEmail(email);
  if (!institution) {
    return res.status(400).json({
      error: 'Please use your institution email address to register.',
    });
  }

  const firebaseUid = `dev_${email.replace(/[^a-z0-9]/gi, '_')}`;
  const userRole = (role as UserRole) || UserRole.STUDENT;
  const department = extractDepartment(email);

  let user = await prisma.user.findUnique({
    where: { firebaseUid },
    include: { wallet: true, vendorCanteen: { select: { id: true, name: true } } },
  });

  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      user = await prisma.user.update({
        where: { email },
        data: { firebaseUid, institutionId: institution.id },
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
          institutionId: institution.id,
          wallet: userRole === UserRole.STUDENT || userRole === UserRole.FACULTY
            ? { create: { balance: 0 } }
            : undefined,
        },
        include: { wallet: true, vendorCanteen: { select: { id: true, name: true } } },
      });
    }
  }

  const token = makeMockToken(firebaseUid, email);
  return res.json({ user, token, institution });
}

// role and email are deliberately absent: email comes from the verified
// Firebase token and role from initialRoleFor(). Extra body keys are ignored.
const registerSchema = z.object({
  firebaseToken: z.string(),
  name: z.string().min(2).max(80).optional(),
  campus: z.string().max(80).optional(),
  phone: z.string().max(20).optional(),
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

  const { firebaseToken, campus, phone } = parse.data;

  const decoded = await verifyFirebaseToken(firebaseToken);
  if (!decoded) return res.status(401).json({ error: 'Invalid token or email not verified' });

  // Email only ever comes from the verified token — a body-supplied email
  // would let anyone claim (and take over) another person's account.
  const email = (decoded.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'Account has no email address' });
  const name: string = parse.data.name || (decoded as any).name || email.split('@')[0];
  const role = initialRoleFor(email);

  const institution = await findInstitutionByEmail(email);
  if (!institution) {
    return res.status(400).json({
      error: 'Please use your institution email address to register.',
    });
  }

  const existingByUid = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
  if (existingByUid) return res.status(409).json({ error: 'User already registered' });

  const department = extractDepartment(email);

  // Existing row with this email (e.g. seeded): safe to link because the token
  // proves ownership of the inbox. Role is left untouched.
  const existingByEmail = await prisma.user.findUnique({ where: { email } });
  if (existingByEmail) {
    const user = await prisma.user.update({
      where: { email },
      data: { firebaseUid: decoded.uid, institutionId: institution.id },
      include: { wallet: true },
    });
    return res.status(200).json({ user, institution });
  }

  const user = await prisma.user.create({
    data: {
      firebaseUid: decoded.uid,
      email,
      name,
      role,
      campus,
      phone,
      department,
      institutionId: institution.id,
      wallet: role === UserRole.STUDENT || role === UserRole.FACULTY
        ? { create: { balance: 0 } }
        : undefined,
    },
    include: { wallet: true },
  });

  return res.status(201).json({ user, institution });
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
