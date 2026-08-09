import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

const { verifyFirebaseToken } = vi.hoisted(() => ({ verifyFirebaseToken: vi.fn() }));
vi.mock('../config/firebase', () => ({ verifyFirebaseToken }));

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../config/database', () => ({ prisma: { user: { findUnique } } }));

vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { authenticateSocket } from './orderSocket';

function fakeSocket(token?: string): Socket {
  return {
    handshake: { auth: token !== undefined ? { token } : {} },
    data: {},
  } as unknown as Socket;
}

describe('authenticateSocket (handshake middleware)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a connection with no token', async () => {
    const next = vi.fn();
    await authenticateSocket(fakeSocket(undefined), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/Authentication required/);
    expect(verifyFirebaseToken).not.toHaveBeenCalled();
  });

  it('rejects when Firebase cannot verify the token', async () => {
    verifyFirebaseToken.mockResolvedValue(null);
    const next = vi.fn();
    await authenticateSocket(fakeSocket('bad-token'), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/Invalid or expired token/);
  });

  it('rejects a verified token for a user not registered in the DB', async () => {
    verifyFirebaseToken.mockResolvedValue({ uid: 'fb-uid-1' });
    findUnique.mockResolvedValue(null);
    const next = vi.fn();
    await authenticateSocket(fakeSocket('good-token'), next);
    expect(next.mock.calls[0][0].message).toMatch(/User not registered/);
  });

  it('rejects a banned user even with a valid token', async () => {
    verifyFirebaseToken.mockResolvedValue({ uid: 'fb-uid-1' });
    findUnique.mockResolvedValue({ id: 'u1', role: 'STUDENT', isBanned: true, vendorCanteen: null });
    const next = vi.fn();
    await authenticateSocket(fakeSocket('good-token'), next);
    expect(next.mock.calls[0][0].message).toMatch(/Account suspended/);
  });

  it('accepts a valid, non-banned user and attaches socket.data.user', async () => {
    verifyFirebaseToken.mockResolvedValue({ uid: 'fb-uid-1' });
    findUnique.mockResolvedValue({
      id: 'u1',
      role: 'VENDOR',
      isBanned: false,
      vendorCanteen: { id: 'canteen-1' },
    });
    const socket = fakeSocket('good-token');
    const next = vi.fn();
    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith(); // called with no error
    expect((socket as any).data.user).toEqual({
      id: 'u1',
      role: 'VENDOR',
      canteenId: 'canteen-1',
    });
  });

  it('rejects when verifyFirebaseToken throws', async () => {
    verifyFirebaseToken.mockRejectedValue(new Error('network blip'));
    const next = vi.fn();
    await authenticateSocket(fakeSocket('good-token'), next);
    expect(next.mock.calls[0][0].message).toMatch(/Authentication failed/);
  });
});
