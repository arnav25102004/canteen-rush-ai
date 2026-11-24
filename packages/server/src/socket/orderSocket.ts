import { Server as SocketIOServer, Socket } from 'socket.io';
import { UserRole } from '@prisma/client';
import { verifyFirebaseToken } from '../config/firebase';
import { prisma } from '../config/database';
import { getAuthUser } from '../services/authUser.service';
import { logger } from '../utils/logger';

interface SocketUser {
  id: string;
  role: UserRole;
  canteenId?: string;
}

// socket.data.user is populated by the handshake middleware below
type AuthedSocket = Socket & { data: { user: SocketUser; uid?: string; tokenExp?: number } };

const ID = /^[\w-]{1,64}$/;
const MAX_ROOMS_PER_SOCKET = 30;
const MAX_SOCKETS_PER_USER = 5;
const EVENT_WINDOW_MS = 10_000;
const MAX_EVENTS_PER_WINDOW = 40;
const SESSION_CHECK_MS = 30_000;

/**
 * Handshake authentication. Clients pass their Firebase ID token as
 * `io(url, { auth: { token } })`. Rooms carry order contents, customer
 * names and pickup codes, so an unauthenticated socket is never allowed.
 */
export async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token || typeof token !== 'string') return next(new Error('Authentication required'));

    const decoded = await verifyFirebaseToken(token);
    if (!decoded) return next(new Error('Invalid or expired token'));

    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
      select: { id: true, role: true, isBanned: true, isDeleted: true, vendorCanteen: { select: { id: true } } },
    });

    if (!user) return next(new Error('User not registered'));
    if (user.isBanned) return next(new Error('Account suspended'));
    if (user.isDeleted) return next(new Error('Account no longer exists'));

    const authed = socket as AuthedSocket;
    authed.data.user = {
      id: user.id,
      role: user.role,
      canteenId: user.vendorCanteen?.id,
    };
    authed.data.uid = decoded.uid;
    authed.data.tokenExp = decoded.exp;
    return next();
  } catch (err) {
    logger.error('Socket authentication failed', { err });
    return next(new Error('Authentication failed'));
  }
}

const isAdmin = (u: SocketUser) => u.role === UserRole.ADMIN;
const isVendorOf = (u: SocketUser, canteenId: string) =>
  (u.role === UserRole.VENDOR || u.role === UserRole.ADMIN) && u.canteenId === canteenId;

/**
 * Closes the transport, not the session: the client reconnects by itself and
 * must pass the handshake again with a fresh token.
 */
const forceReauth = (socket: Socket) => socket.conn.close();

/** Drops sockets whose token expired or whose account was banned, deleted or changed role. */
async function checkSessions(io: SocketIOServer) {
  const nowSeconds = Date.now() / 1000;
  for (const socket of io.of('/').sockets.values()) {
    const { user, uid, tokenExp } = (socket as AuthedSocket).data;
    if (!user) continue;
    if (tokenExp && tokenExp <= nowSeconds) { forceReauth(socket); continue; }
    if (!uid) continue;
    try {
      const current = await getAuthUser(uid);
      if (!current || current.isBanned || current.isDeleted || current.role !== user.role
        || current.vendorCanteen?.id !== user.canteenId) {
        forceReauth(socket);
      }
    } catch {
      // DB unavailable: keep the socket, the next pass checks again
    }
  }
}

/** Disconnects a user on every instance (ban, role change, account deletion). */
export function disconnectUser(io: { in: (room: string) => { disconnectSockets: (close?: boolean) => void } } | undefined, userId: string) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

export function setupSocketIO(io: SocketIOServer) {
  io.use(authenticateSocket);

  const perUser = new Map<string, number>();
  setInterval(() => {
    void checkSessions(io).catch((err) => logger.warn('Socket session check failed', { err: err?.message }));
  }, SESSION_CHECK_MS).unref();

  io.on('connection', (socket: Socket) => {
    const user = (socket as AuthedSocket).data.user;

    const open = (perUser.get(user.id) ?? 0) + 1;
    if (open > MAX_SOCKETS_PER_USER) {
      socket.emit('error', { event: 'connection', error: 'Too many connections' });
      socket.disconnect(true);
      return;
    }
    perUser.set(user.id, open);
    socket.on('disconnect', () => {
      const left = (perUser.get(user.id) ?? 1) - 1;
      if (left <= 0) perUser.delete(user.id); else perUser.set(user.id, left);
    });
    socket.join(`user:${user.id}`);

    let windowStart = Date.now();
    let events = 0;
    const allowEvent = () => {
      const now = Date.now();
      if (now - windowStart > EVENT_WINDOW_MS) { windowStart = now; events = 0; }
      events += 1;
      return events <= MAX_EVENTS_PER_WINDOW;
    };

    const deny = (event: string, detail: Record<string, unknown>) => {
      logger.warn('Socket room join denied', { event, userId: user.id, role: user.role, ...detail });
      socket.emit('error', { event, error: 'Forbidden' });
    };

    const joinRoom = (event: string, room: string) => {
      if (socket.rooms.size >= MAX_ROOMS_PER_SOCKET && !socket.rooms.has(room)) {
        return deny(event, { reason: 'room limit' });
      }
      socket.join(room);
    };

    /**
     * A client controls these payloads. A throw here would be an uncaught
     * exception and take the whole server down, so nothing may escape.
     */
    const handle = (event: string, field: string, fn: (id: string) => void | Promise<void>) => {
      socket.on(event, (payload: unknown) => {
        if (!allowEvent()) return;
        const id = (payload as Record<string, unknown> | null | undefined)?.[field];
        if (typeof id !== 'string' || !ID.test(id)) return;
        try {
          Promise.resolve(fn(id)).catch((err) => logger.error(`${event} failed`, { err, userId: user.id }));
        } catch (err) {
          logger.error(`${event} failed`, { err, userId: user.id });
        }
      });
    };

    // Order room — the student who placed it, or the canteen preparing it
    handle('join:order', 'orderId', async (orderId) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { userId: true, canteenId: true },
      });
      if (!order) return deny('join:order', { orderId });

      const allowed = isAdmin(user) || order.userId === user.id || isVendorOf(user, order.canteenId);
      if (!allowed) return deny('join:order', { orderId });

      joinRoom('join:order', `order:${orderId}`);
    });
    handle('leave:order', 'orderId', (orderId) => { socket.leave(`order:${orderId}`); });

    // Canteen room — vendor KDS. Only the assigned vendor (or an admin).
    handle('join:canteen', 'canteenId', (canteenId) => {
      if (!isAdmin(user) && !isVendorOf(user, canteenId)) return deny('join:canteen', { canteenId });
      joinRoom('join:canteen', `canteen:${canteenId}`);
    });
    handle('leave:canteen', 'canteenId', (canteenId) => { socket.leave(`canteen:${canteenId}`); });

    // Menu room — public menu changes (e.g. out of stock), safe for any signed-in user
    handle('join:menu', 'canteenId', (canteenId) => joinRoom('join:menu', `menu:${canteenId}`));
    handle('leave:menu', 'canteenId', (canteenId) => { socket.leave(`menu:${canteenId}`); });

    // Slot room — only aggregate availability counts, safe for any signed-in user
    handle('join:slot', 'slotId', (slotId) => joinRoom('join:slot', `slot:${slotId}`));
    handle('leave:slot', 'slotId', (slotId) => { socket.leave(`slot:${slotId}`); });

    // Student room — you may only ever subscribe to yourself
    handle('join:student', 'studentId', (studentId) => {
      if (studentId !== user.id && !isAdmin(user)) return deny('join:student', { studentId });
      joinRoom('join:student', `student:${studentId}`);
    });
    handle('leave:student', 'studentId', (studentId) => { socket.leave(`student:${studentId}`); });

    // Socket.IO auto-removes from all rooms on disconnect
  });
}
