import cron from 'node-cron';
import { prisma } from '../config/database';
import { generateDefaultSlots } from '../services/slot.service';
import { istDateKey } from '../utils/helpers';

/** UTC-midnight Date for the IST calendar day `daysAhead` from today (what a @db.Date column stores). */
function istDayAhead(daysAhead: number): Date {
  const key = istDateKey(); // YYYYMMDD
  return new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8) + daysAhead));
}

export function startSlotGenerationJob() {
  // Midnight IST every day — generate slots for the next 7 days
  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron] Generating slots for next 7 days...');
    try {
      const canteens = await prisma.canteen.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      for (const canteen of canteens) {
        for (let i = 1; i <= 7; i++) {
          await generateDefaultSlots(canteen.id, istDayAhead(i));
        }
      }

      console.log(`[Cron] Slots generated for ${canteens.length} canteens`);
    } catch (err: any) {
      console.error('[Cron] Slot generation failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('[Cron] Slot generation job scheduled (daily at midnight IST)');
}
