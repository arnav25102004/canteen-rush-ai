import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../config/firebase';
import { prisma } from '../config/database';
import { UserRole } from '@prisma/client';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    firebaseUid: string;
    email: string;
    name: string;
    role: UserRole;
    canteenId?: string;
  };
  io?: any;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);
  const decoded = await verifyFirebaseToken(token);

  if (!decoded) {
    logger.warn('Failed auth attempt — invalid token', {
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
    });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = await prisma.user.findUnique({
    where: { firebaseUid: decoded.uid },
    include: { vendorCanteen: { select: { id: true } } },
  });

  if (!user) {
    return res.status(401).json({ error: 'User not registered. Please register first.' });
  }

  if (user.isBanned) {
    logger.warn('Banned user attempted access', { userId: user.id, ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'Account suspended.' });
  }

  req.user = {
    id: user.id,
    firebaseUid: user.firebaseUid,
    email: user.email,
    name: user.name,
    role: user.role,
    canteenId: user.vendorCanteen?.id,
  };

  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    next();
  };
}

export const requireVendor = requireRole(UserRole.VENDOR, UserRole.ADMIN);
export const requireAdmin = requireRole(UserRole.ADMIN);
export const requireStudent = requireRole(UserRole.STUDENT, UserRole.FACULTY, UserRole.ADMIN);

// Attaches user if token present but does not reject unauthenticated requests
export async function optionalAuthenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  const token = authHeader.slice(7);
  const decoded = await verifyFirebaseToken(token);
  if (!decoded) return next();

  const user = await prisma.user.findUnique({
    where: { firebaseUid: decoded.uid },
    include: { vendorCanteen: { select: { id: true } } },
  });
  if (user && !user.isBanned) {
    req.user = {
      id: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email,
      name: user.name,
      role: user.role,
      canteenId: user.vendorCanteen?.id,
    };
  }
  next();
}
