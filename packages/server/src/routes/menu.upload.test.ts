import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { upload } from './menu.routes';

function testApp() {
  const app = express();
  app.post('/upload', upload.single('image'), (req, res) => {
    res.json({ ok: true, mimetype: req.file?.mimetype });
  });
  // multer errors (wrong mime / too large) surface via next(err) — catch them here
  // the same way the app's global error handler would, but simplified for the test.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(400).json({ error: err.message });
  });
  return app;
}

describe('menu item image upload restrictions', () => {
  it('accepts an allowed image mime type under the size limit', async () => {
    const app = testApp();
    const res = await request(app)
      .post('/upload')
      .attach('image', Buffer.from('fake-jpeg-bytes'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.mimetype).toBe('image/jpeg');
  });

  it('rejects a disallowed mime type (e.g. application/pdf)', async () => {
    const app = testApp();
    const res = await request(app)
      .post('/upload')
      .attach('image', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only JPEG, PNG and WebP images are allowed/);
  });

  it('rejects a file over the 5MB limit', async () => {
    const app = testApp();
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    const res = await request(app)
      .post('/upload')
      .attach('image', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });
});
