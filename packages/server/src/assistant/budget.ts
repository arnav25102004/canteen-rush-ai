import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { istDateKey } from '../utils/helpers';
import { logger } from '../utils/logger';
import { AssistantConfig, loadAssistantConfig } from './config';

export const MAX_TURNS_PER_USER = 40;
const UNCAPPED_TURNS = 2_000_000_000;

export type ReserveResult =
  | { ok: true; userTokensToday: number; globalTokensToday: number }
  | { ok: false; reason: 'user_limit' | 'global_limit' | 'error' };

const T = Prisma.raw('assistant_daily_usage');

async function reserveRow(scope: string, day: string, maxTurns: number, maxTokens: number): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ tokens: number }>>(Prisma.sql`
    INSERT INTO ${T} (scope, day, turns, tokens) VALUES (${scope}, ${day}, 1, 0)
    ON CONFLICT (scope, day) DO UPDATE SET turns = ${T}.turns + 1
    WHERE ${T}.turns < ${maxTurns} AND ${T}.tokens < ${maxTokens}
    RETURNING tokens`);
  return rows.length > 0 ? Number(rows[0].tokens) : null;
}

/**
 * Reserves one turn for the student and the whole app in single atomic
 * statements. Any error, or no row back, refuses the turn: a broken budget
 * never means free usage (fail closed).
 */
export async function reserveTurn(userId: string, cfg: AssistantConfig = loadAssistantConfig()): Promise<ReserveResult> {
  const day = istDateKey();
  try {
    const user = await reserveRow(userId, day, MAX_TURNS_PER_USER, cfg.userDailyTokens);
    if (user === null) return { ok: false, reason: 'user_limit' };
    let global: number | null;
    try {
      global = await reserveRow('global', day, UNCAPPED_TURNS, cfg.globalDailyTokens);
    } catch (err) {
      await decrement([userId]);
      throw err;
    }
    if (global === null) {
      await decrement([userId]);
      return { ok: false, reason: 'global_limit' };
    }
    return { ok: true, userTokensToday: user, globalTokensToday: global };
  } catch (err) {
    logger.error('assistant reserveTurn failed (refusing)', { error: (err as Error)?.message });
    return { ok: false, reason: 'error' };
  }
}

/** Adds tokens to the user, global and per-model rows. Call after EVERY LLM call. Never throws. */
export async function recordTokens(userId: string, model: string, tokens: number): Promise<void> {
  const n = Math.max(0, Math.round(tokens) || 0);
  if (n === 0) return;
  const day = istDateKey();
  const scopes = [userId, 'global', `model:${model}`];
  try {
    const values = Prisma.join(scopes.map((s) => Prisma.sql`(${s}, ${day}, 0, ${n})`));
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T} (scope, day, turns, tokens) VALUES ${values}
      ON CONFLICT (scope, day) DO UPDATE SET tokens = ${T}.tokens + EXCLUDED.tokens`);
  } catch (err) {
    logger.warn('assistant recordTokens failed', { error: (err as Error)?.message });
  }
}

async function decrement(scopes: string[]): Promise<void> {
  const day = istDateKey();
  try {
    await prisma.assistantDailyUsage.updateMany({
      where: { scope: { in: scopes }, day, turns: { gt: 0 } },
      data: { turns: { decrement: 1 } },
    });
  } catch (err) {
    logger.warn('assistant giveBackTurn failed', { error: (err as Error)?.message });
  }
}

/** Gives a fully reserved turn (user and global) back when it produced no answer. Never goes below zero. Never throws. */
export function giveBackTurn(userId: string): Promise<void> {
  return decrement([userId, 'global']);
}

/** Today's usage for the capabilities endpoint. Throws on DB errors (the caller reports "unavailable"). */
export async function getUsageToday(userId: string): Promise<{ turns: number; globalTokens: number }> {
  const day = istDateKey();
  const rows = await prisma.assistantDailyUsage.findMany({ where: { scope: { in: [userId, 'global'] }, day } });
  return {
    turns: rows.find((r) => r.scope === userId)?.turns ?? 0,
    globalTokens: rows.find((r) => r.scope === 'global')?.tokens ?? 0,
  };
}
