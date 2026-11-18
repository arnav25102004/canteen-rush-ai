import cron, { ScheduledTask } from 'node-cron';
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
        if (n > 0) console.log(`[Cron] Notified ${n} feedback SLA breaches`);
      });
    } catch (err: any) {
      console.error('[Cron] Feedback SLA job error:', err.message);
    } finally {
      running = false;
    }
  });

  console.log('[Cron] Feedback SLA job scheduled (every 15 minutes)');
  return task;
}
