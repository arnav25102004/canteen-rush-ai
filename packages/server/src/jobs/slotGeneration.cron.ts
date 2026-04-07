import cron from 'node-cron';
import { prisma } from '../config/database';
import { generateDefaultSlots } from '../services/slot.service';

export function startSlotGenerationJob() {
  // Run at midnight every day — generate slots for next 7 days
  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron] Generating slots for next 7 days...');
    const canteens = await prisma.canteen.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    for (const canteen of canteens) {
      for (let i = 1; i <= 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        date.setHours(0, 0, 0, 0);
        await generateDefaultSlots(canteen.id, date);
      }
    }

    console.log(`[Cron] Slots generated for ${canteens.length} canteens`);
  });

  console.log('[Cron] Slot generation job scheduled (daily at midnight)');
}
