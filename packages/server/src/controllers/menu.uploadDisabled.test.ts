import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Cloudinary keys deliberately absent: uploads must degrade to a clear 503, not crash boot.
vi.mock('../config/database', () => ({ prisma: {} }));
vi.mock('../config/redis', () => ({ cacheDel: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), KEYS: {} }));

describe('uploadItemImage without Cloudinary configured', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  it('cloudinaryConfigured is false with no keys', async () => {
    const { cloudinaryConfigured } = await import('../config/cloudinary');
    expect(cloudinaryConfigured).toBe(false);
  });

  it('cloudinaryConfigured is false with only some keys', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'c';
    const { cloudinaryConfigured } = await import('../config/cloudinary');
    expect(cloudinaryConfigured).toBe(false);
  });

  it('answers 503 with a friendly message and still deletes the temp file', async () => {
    const { uploadItemImage } = await import('./menu.controller');
    const tmp = path.join(os.tmpdir(), `ck-upload-${Date.now()}.jpg`);
    fs.writeFileSync(tmp, 'x');

    let status = 0;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(b: unknown) { body = b; return this; },
    };
    await uploadItemImage({ file: { path: tmp } } as never, res as never);

    expect(status).toBe(503);
    expect(JSON.stringify(body)).toMatch(/not set up/i);
    await new Promise((r) => setTimeout(r, 50)); // unlink is fire-and-forget
    expect(fs.existsSync(tmp)).toBe(false);
  });
});
