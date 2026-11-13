import { describe, it, expect, afterEach } from 'vitest';
import { verifyFirebaseToken } from './firebase';
import { initialRoleFor } from '../controllers/auth.controller';

const mock = (payload: object) =>
  `dev.${Buffer.from(JSON.stringify(payload)).toString('base64')}.mock`;

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

describe('verifyFirebaseToken', () => {
  it('rejects mock tokens unless DEV_AUTH=true', async () => {
    delete process.env.DEV_AUTH;
    process.env.NODE_ENV = 'development';
    expect(await verifyFirebaseToken(mock({ uid: 'admin-uid' }))).toBeNull();
  });

  it('rejects mock tokens in production even with DEV_AUTH=true', async () => {
    process.env.DEV_AUTH = 'true';
    process.env.NODE_ENV = 'production';
    expect(await verifyFirebaseToken(mock({ uid: 'admin-uid' }))).toBeNull();
  });

  it('accepts mock tokens in local dev with DEV_AUTH=true', async () => {
    process.env.DEV_AUTH = 'true';
    process.env.NODE_ENV = 'development';
    expect(await verifyFirebaseToken(mock({ uid: 'u1' }))).toMatchObject({ uid: 'u1' });
  });

  it('never decodes an unverified JWT when Firebase Admin is not configured', async () => {
    const fakeJwt = `x.${Buffer.from(JSON.stringify({ uid: 'admin-uid' })).toString('base64')}.y`;
    expect(await verifyFirebaseToken(fakeJwt)).toBeNull();
  });
});

describe('initialRoleFor', () => {
  it('gives ADMIN only to allowlisted emails, STUDENT to everyone else', () => {
    process.env.ADMIN_EMAILS = 'Boss@christuniversity.in, ops@christuniversity.in';
    expect(initialRoleFor('boss@christuniversity.in')).toBe('ADMIN');
    expect(initialRoleFor('admin.fake@christuniversity.in')).toBe('STUDENT');
  });
});
