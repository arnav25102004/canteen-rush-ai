import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/database';
import { withAdvisoryLock, LOCK_KEYS } from '../utils/advisoryLock';
import { logger } from '../utils/logger';

const DAY_MS = 24 * 60 * 60 * 1000;

export const ASSISTANT_RETENTION_DAYS = { messages: 30, proposals: 7, ledger: 90 } as const;

/**
 * Deletes assistant data past its retention: messages 30d, proposals 7d,
 * call ledger 90d. Reports keep a null message link when their message goes.
 */
export async function purgeAssistantData(now = new Date()) {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const messages = await prisma.assistantMessage.deleteMany({
    where: { createdAt: { lt: before(ASSISTANT_RETENTION_DAYS.messages) } },
  });
  const proposals = await prisma.assistantProposal.deleteMany({
    where: { createdAt: { lt: before(ASSISTANT_RETENTION_DAYS.proposals) } },
  });
  const ledger = await prisma.assistantCallLog.deleteMany({
    where: { createdAt: { lt: before(ASSISTANT_RETENTION_DAYS.ledger) } },
  });
  return { messages: messages.count, proposals: proposals.count, ledger: ledger.count };
}

export function startAssistantRetentionJob(): ScheduledTask {
  let running = false;

  // 03:30 IST daily
  const task = cron.schedule('30 3 * * *', async () => {
    if (running) return;
    running = true;
    try {
      await withAdvisoryLock(LOCK_KEYS.assistantRetention, async () => {
        const res = await purgeAssistantData();
        logger.info('Assistant retention purge', res);
      });
    } catch (err: any) {
      logger.error('Assistant retention job error', { err: err?.message });
    } finally {
      running = false;
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('[Cron] Assistant retention job scheduled (daily 03:30 IST)');
  return task;
}
