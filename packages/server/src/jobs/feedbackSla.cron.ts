import cron, { ScheduledTask } from 'node-cron';
import { logger } from '../utils/logger';
import { withAdvisoryLock, LOCK_KEYS } from '../utils/advisoryLock';
import { runSlaBreaches } from '../services/feedbackSla.service';

export function startFeedbackSlaJob(): ScheduledTask {
  let running = false;

  const task = cron.schedule('*/15 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await withAdvisoryLock(LOCK_KEYS.feedbackSla, async () => {
        const n = await runSlaBreaches();
        if (n > 0) logger.info(`[Cron] Notified ${n} feedback SLA breaches`);
      });
    } catch (err: any) {
      logger.error('[Cron] Feedback SLA job error', { error: err.message });
    } finally {
      running = false;
    }
  });

  logger.info('[Cron] Feedback SLA job scheduled (every 15 minutes)');
  return task;
}
