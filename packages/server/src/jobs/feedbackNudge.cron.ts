import cron, { ScheduledTask } from 'node-cron';
import { withAdvisoryLock, LOCK_KEYS } from '../utils/advisoryLock';
import { runFeedbackNudges } from '../services/feedbackNudge.service';

export function startFeedbackNudgeJob(): ScheduledTask {
  let running = false;

  const task = cron.schedule('*/5 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await withAdvisoryLock(LOCK_KEYS.feedbackNudge, async () => {
        const n = await runFeedbackNudges();
        if (n > 0) console.log(`[Cron] Sent ${n} feedback nudges`);
      });
    } catch (err: any) {
      console.error('[Cron] Feedback nudge job error:', err.message);
    } finally {
      running = false;
    }
  });

  console.log('[Cron] Feedback nudge job scheduled (every 5 minutes)');
  return task;
}
