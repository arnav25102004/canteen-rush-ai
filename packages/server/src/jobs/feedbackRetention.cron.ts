import cron, { ScheduledTask } from 'node-cron';
import { withAdvisoryLock, LOCK_KEYS } from '../utils/advisoryLock';
import { runRetention, reconcileAggregates } from '../services/feedbackRetention.service';

export function startFeedbackRetentionJob(): ScheduledTask {
  let running = false;

  // 02:30 IST (21:00 UTC), when traffic is lowest.
  const task = cron.schedule('0 21 * * *', async () => {
    if (running) return;
    running = true;
    try {
      await withAdvisoryLock(LOCK_KEYS.feedbackRetention, async () => {
        await runRetention();
        await reconcileAggregates();
      });
    } catch (err: any) {
      console.error('[Cron] Feedback retention job error:', err.message);
    } finally {
      running = false;
    }
  });

  console.log('[Cron] Feedback retention + reconcile job scheduled (daily 21:00 UTC)');
  return task;
}
