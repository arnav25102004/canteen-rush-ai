import { Server as SocketIOServer, Socket } from 'socket.io';
import { UserRole } from '@prisma/client';
import { verifyFirebaseToken } from '../config/firebase';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

interface SocketUser {
  id: string;
  role: UserRole;
  canteenId?: string;
}

// socket.data.user is populated by the handshake middleware below
type AuthedSocket = Socket & { data: { user: SocketUser } };

/**
 * Handshake authentication. Clients pass their Firebase ID token as
 * `io(url, { auth: { token } })`. Rooms carry order contents, customer
 * names and pickup codes, so an unauthenticated socket is never allowed.
 */
export async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));

    const decoded = await verifyFirebaseToken(token);
    if (!decoded) return next(new Error('Invalid or expired token'));

    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
      select: { id: true, role: true, isBanned: true, isDeleted: true, vendorCanteen: { select: { id: true } } },
    });

    if (!user) return next(new Error('User not registered'));
    if (user.isBanned) return next(new Error('Account suspended'));
    if (user.isDeleted) return next(new Error('Account no longer exists'));

    (socket as AuthedSocket).data.user = {
      id: user.id,
      role: user.role,
      canteenId: user.vendorCanteen?.id,
    };
    return next();
  } catch (err) {
    logger.error('Socket authentication failed', { err });
    return next(new Error('Authentication failed'));
  }
}

const isAdmin = (u: SocketUser) => u.role === UserRole.ADMIN;
const isVendorOf = (u: SocketUser, canteenId: string) =>
  (u.role === UserRole.VENDOR || u.role === UserRole.ADMIN) && u.canteenId === canteenId;

export function setupSocketIO(io: SocketIOServer) {
  io.use(authenticateSocket);

  io.on('connection', (socket: Socket) => {
    const user = (socket as AuthedSocket).data.user;

    const deny = (event: string, detail: Record<string, unknown>) => {
      logger.warn('Socket room join denied', { event, userId: user.id, role: user.role, ...detail });
      socket.emit('error', { event, error: 'Forbidden' });
    };

    // Order room — the student who placed it, or the canteen preparing it
    socket.on('join:order', async ({ orderId }: { orderId: string }) => {
      try {
        if (!orderId) return;
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: { userId: true, canteenId: true },
        });
        if (!order) return deny('join:order', { orderId });

        const allowed = isAdmin(user) || order.userId === user.id || isVendorOf(user, order.canteenId);
        if (!allowed) return deny('join:order', { orderId });

        socket.join(`order:${orderId}`);
      } catch (err) {
        logger.error('join:order failed', { err, orderId, userId: user.id });
      }
    });

    socket.on('leave:order', ({ orderId }: { orderId: string }) => {
      if (orderId) socket.leave(`order:${orderId}`);
    });

    // Canteen room — vendor KDS. Only the assigned vendor (or an admin).
    socket.on('join:canteen', ({ canteenId }: { canteenId: string }) => {
      if (!canteenId) return;
      if (!isAdmin(user) && !isVendorOf(user, canteenId)) return deny('join:canteen', { canteenId });
      socket.join(`canteen:${canteenId}`);
    });

    socket.on('leave:canteen', ({ canteenId }: { canteenId: string }) => {
      if (canteenId) socket.leave(`canteen:${canteenId}`);
    });

    // Slot room — only aggregate availability counts, safe for any signed-in user
    socket.on('join:slot', ({ slotId }: { slotId: string }) => {
      if (slotId) socket.join(`slot:${slotId}`);
    });

    socket.on('leave:slot', ({ slotId }: { slotId: string }) => {
      if (slotId) socket.leave(`slot:${slotId}`);
    });

    // Student room — you may only ever subscribe to yourself
    socket.on('join:student', ({ studentId }: { studentId: string }) => {
      if (!studentId) return;
      if (studentId !== user.id && !isAdmin(user)) return deny('join:student', { studentId });
      socket.join(`student:${studentId}`);
    });

    socket.on('leave:student', ({ studentId }: { studentId: string }) => {
      if (studentId) socket.leave(`student:${studentId}`);
    });

    // Socket.IO auto-removes from all rooms on disconnect
  });
}
