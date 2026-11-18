/**
 * Turn lock and idempotency against a real Postgres. Skipped unless TEST_DATABASE_URL points at a
 * throwaway database with migrations applied (see assistant.integration.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET ||= 'integration-test-only-secret-not-for-production';

describe.skipIf(!url)('assistant turn lock and idempotency (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const { acquireTurnLock, releaseTurnLock, findExistingTurn, getOrCreateConversation, saveTurn, loadHistoryForModel } = await import('./history');

  const tag = `tl${Date.now()}`;
  let userId = '';
  let otherId = '';

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } });
    userId = (await prisma.user.create({ data: { firebaseUid: tag, email: `a@${tag}.edu`, name: 'A', role: 'STUDENT', institutionId: inst.id } })).id;
    otherId = (await prisma.user.create({ data: { firebaseUid: `${tag}2`, email: `b@${tag}.edu`, name: 'B', role: 'STUDENT', institutionId: inst.id } })).id;
  });

  afterAll(async () => {
    await prisma.assistantConversation.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it('only one of many parallel turns gets the lock, and it can be taken again after release or expiry', async () => {
    const conv = await getOrCreateConversation(userId);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => acquireTurnLock(conv.id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ status: 409, code: 'TURN_IN_PROGRESS' });

    await releaseTurnLock(conv.id);
    await acquireTurnLock(conv.id);
    // A lock whose time has passed can be taken over (a crashed turn does not block the chat).
    await prisma.assistantConversation.update({ where: { id: conv.id }, data: { busyUntil: new Date(Date.now() - 1000) } });
    await acquireTurnLock(conv.id);
    await releaseTurnLock(conv.id);
  });

  it('a conversation belongs to its user', async () => {
    const conv = await getOrCreateConversation(userId);
    await expect(getOrCreateConversation(otherId, conv.id)).rejects.toMatchObject({ status: 404 });
    expect((await getOrCreateConversation(userId, conv.id)).id).toBe(conv.id);
  });

  it('saving the same clientTurnId twice keeps one pair of rows and replays the stored reply', async () => {
    const conv = await getOrCreateConversation(userId);
    const clientTurnId = crypto.randomUUID();
    const reply = { text: 'Here you go', cards: [], chips: [{ label: 'Popular now', action: { type: 'popular_now' } }] };
    const first = await saveTurn({ conversationId: conv.id, clientTurnId, userText: 'hi', reply, outcome: 'ok' });
    const second = await saveTurn({ conversationId: conv.id, clientTurnId, userText: 'hi', reply, outcome: 'ok' });
    expect(second).toBe(first);
    expect(await prisma.assistantMessage.count({ where: { conversationId: conv.id } })).toBe(2);
    expect(await findExistingTurn(conv.id, clientTurnId)).toMatchObject({ id: first, text: 'Here you go', outcome: 'ok' });
    expect(await findExistingTurn(conv.id, crypto.randomUUID())).toBeNull();
    const { messages } = await loadHistoryForModel(conv.id, 4);
    expect(messages.map((x) => x.role)).toEqual(['user', 'assistant']);
  });

  it('a degraded reply is not replayed and is replaced when the turn is retried', async () => {
    const conv = await getOrCreateConversation(userId);
    const clientTurnId = crypto.randomUUID();
    await saveTurn({ conversationId: conv.id, clientTurnId, userText: 'hi', reply: { text: 'busy', cards: [], chips: [] }, outcome: 'degraded' });
    expect(await findExistingTurn(conv.id, clientTurnId)).toBeNull();
    await saveTurn({ conversationId: conv.id, clientTurnId, userText: 'hi', reply: { text: 'real answer', cards: [], chips: [] }, outcome: 'ok' });
    expect(await prisma.assistantMessage.count({ where: { conversationId: conv.id } })).toBe(2);
    expect((await findExistingTurn(conv.id, clientTurnId))?.text).toBe('real answer');
  });
});
