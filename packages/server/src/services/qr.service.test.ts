import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const VALID_SECRET = 'a'.repeat(32);

describe('qr.service secret validation', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('throws on import when JWT_SECRET is unset', async () => {
    delete process.env.JWT_SECRET;
    await expect(import('./qr.service')).rejects.toThrow(/JWT_SECRET must be set/);
  });

  it('throws on import when JWT_SECRET is shorter than 32 chars', async () => {
    process.env.JWT_SECRET = 'too-short';
    await expect(import('./qr.service')).rejects.toThrow(/JWT_SECRET must be set/);
  });

  it('loads successfully with a 32+ char secret', async () => {
    process.env.JWT_SECRET = VALID_SECRET;
    await expect(import('./qr.service')).resolves.toBeTruthy();
  });
});

describe('qr.service token round-trip', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.JWT_SECRET = VALID_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  const payload = {
    orderId: 'order_1',
    userId: 'user_1',
    orderNumber: 'CR-1001',
    canteenId: 'canteen_1',
  };

  it('generates a token that verifies back to the original payload', async () => {
    const { generateQRToken, verifyQRToken } = await import('./qr.service');
    const token = generateQRToken(payload);
    const decoded = verifyQRToken(token);
    expect(decoded).toMatchObject(payload);
  });

  it('rejects a token signed with a different secret', async () => {
    const { generateQRToken } = await import('./qr.service');
    const token = generateQRToken(payload);

    vi.resetModules();
    process.env.JWT_SECRET = 'b'.repeat(32);
    const { verifyQRToken } = await import('./qr.service');
    expect(verifyQRToken(token)).toBeNull();
  });

  it('rejects a garbage token', async () => {
    const { verifyQRToken } = await import('./qr.service');
    expect(verifyQRToken('not-a-real-jwt')).toBeNull();
  });
});
