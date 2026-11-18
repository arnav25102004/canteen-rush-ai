import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { AssistantCard } from './cards';
import { AssistantError } from './errors';
import { HISTORY_CLIP_CHARS, HISTORY_MESSAGES } from './loop';
import { summarizeCardForModel } from './prompt';
import { ChatMessage } from './provider/types';
import { RefMap } from './refs';

export const TURN_LOCK_MS = 40_000;

export interface StoredReply {
  id: string;
  text: string;
  cards: AssistantCard[];
  chips: unknown[];
  outcome: string | null;
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** The conversation (must belong to the user) or a new one. */
export async function getOrCreateConversation(userId: string, conversationId?: string): Promise<{ id: string; refs: RefMap }> {
  if (conversationId) {
    const found = await prisma.assistantConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true, refs: true } });
    if (!found) throw new AppError(404, 'Conversation not found');
    return { id: found.id, refs: RefMap.fromJson(found.refs) };
  }
  const created = await prisma.assistantConversation.create({ data: { userId }, select: { id: true } });
  return { id: created.id, refs: new RefMap() };
}

/** One turn at a time per conversation. Takes the lock for 40s or throws 409 TURN_IN_PROGRESS. */
export async function acquireTurnLock(conversationId: string, now: Date = new Date()): Promise<void> {
  const res = await prisma.assistantConversation.updateMany({
    where: { id: conversationId, OR: [{ busyUntil: null }, { busyUntil: { lt: now } }] },
    data: { busyUntil: new Date(now.getTime() + TURN_LOCK_MS) },
  });
  if (res.count === 0) throw new AssistantError(409, 'TURN_IN_PROGRESS', 'The assistant is still answering your last message.');
}

export async function releaseTurnLock(conversationId: string): Promise<void> {
  await prisma.assistantConversation.updateMany({ where: { id: conversationId }, data: { busyUntil: null } });
}

/** The stored reply for a retried clientTurnId. A degraded ("busy") reply is not replayed, so a retry can succeed. */
export async function findExistingTurn(conversationId: string, clientTurnId: string): Promise<StoredReply | null> {
  const row = await prisma.assistantMessage.findFirst({
    where: { conversationId, clientTurnId, role: 'ASSISTANT' },
    select: { id: true, text: true, cards: true, chips: true, outcome: true },
  });
  if (!row || row.outcome === 'degraded') return null;
  return { id: row.id, text: row.text, cards: asArray(row.cards), chips: asArray(row.chips), outcome: row.outcome };
}

/**
 * The last messages for the model: at most `limit`, text clipped, card summaries instead of cards,
 * never tool results. Refused exchanges are left out so refused text is not replayed. Also returns
 * the last assistant card (for the router).
 */
export async function loadHistoryForModel(conversationId: string, limit: number = HISTORY_MESSAGES): Promise<{ messages: ChatMessage[]; lastCard: AssistantCard | null }> {
  const rows = await prisma.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: Math.max(limit * 3, 12),
    select: { id: true, role: true, text: true, cards: true, outcome: true, replyToId: true },
  });
  const refusedUsers = new Set(rows.filter((r) => r.role === 'ASSISTANT' && r.outcome?.startsWith('refused') && r.replyToId).map((r) => r.replyToId as string));
  const kept = rows
    .filter((r) => !(r.role === 'ASSISTANT' && r.outcome?.startsWith('refused')) && !refusedUsers.has(r.id) && r.outcome !== 'degraded')
    .slice(0, limit)
    .reverse();
  const lastCardRow = rows.find((r) => r.role === 'ASSISTANT' && asArray(r.cards).length > 0);
  const messages: ChatMessage[] = kept.map((r) => {
    const clipped = r.text.length > HISTORY_CLIP_CHARS ? `${r.text.slice(0, HISTORY_CLIP_CHARS - 1)}…` : r.text;
    const cards = r.role === 'ASSISTANT' ? asArray(r.cards) : [];
    const summary = cards.map((c) => summarizeCardForModel(c as AssistantCard)).join(' ');
    return { role: r.role === 'USER' ? 'user' : 'assistant', content: summary ? `${clipped} ${summary}` : clipped };
  });
  return { messages, lastCard: (asArray(lastCardRow?.cards)[0] as AssistantCard | undefined) ?? null };
}

export interface SaveTurnInput {
  conversationId: string;
  clientTurnId: string;
  userText: string;
  reply: { text: string; cards: AssistantCard[]; chips: unknown[] };
  outcome: string;
}

/**
 * Saves the USER and ASSISTANT rows together. It upserts on (conversation, clientTurnId, role), so
 * saving the same turn twice (a replayed refusal, or a retry after a "busy" reply) is harmless.
 * Returns the assistant message id.
 */
export async function saveTurn(input: SaveTurnInput): Promise<string> {
  const { conversationId, clientTurnId } = input;
  return prisma.$transaction(async (tx) => {
    const user = await tx.assistantMessage.upsert({
      where: { conversationId_clientTurnId_role: { conversationId, clientTurnId, role: 'USER' } },
      create: { conversationId, clientTurnId, role: 'USER', text: input.userText },
      update: { text: input.userText },
      select: { id: true },
    });
    const data = {
      text: input.reply.text,
      cards: input.reply.cards as unknown as Prisma.InputJsonValue,
      chips: input.reply.chips as unknown as Prisma.InputJsonValue,
      outcome: input.outcome,
      replyToId: user.id,
    };
    const assistant = await tx.assistantMessage.upsert({
      where: { conversationId_clientTurnId_role: { conversationId, clientTurnId, role: 'ASSISTANT' } },
      create: { conversationId, clientTurnId, role: 'ASSISTANT', ...data },
      update: data,
      select: { id: true },
    });
    await tx.assistantConversation.updateMany({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return assistant.id;
  });
}
