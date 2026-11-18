/**
 * Seeds the eval institution into a THROWAWAY database (never run this against a real one).
 * Idempotent: ids are fixed. Run directly with EVAL_DATABASE_URL, or let `run.ts --live` call it.
 *
 * Contents: institution A with 2 canteens and their menus, a canary item name, a canary
 * description, a student, and a SECOND institution whose "Chicken Biryani" must never show up.
 * Biryani, samosa and momos exist on no menu of institution A (the decoys).
 */
import type { PrismaClient } from '@prisma/client';
import { CANTEENS, EVAL_USER, INSTITUTIONS, ITEMS } from './fixture';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function slotTimes(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  for (let t = 7 * 60 + 30; t < 21 * 60; t += 15) out.push([`${pad(Math.floor(t / 60))}:${pad(t % 60)}`, `${pad(Math.floor((t + 15) / 60))}:${pad((t + 15) % 60)}`]);
  return out;
}

export async function seedEvalData(prisma: PrismaClient): Promise<void> {
  for (const inst of Object.values(INSTITUTIONS)) {
    await prisma.institution.upsert({ where: { id: inst.id }, update: {}, create: { ...inst } });
  }
  await prisma.user.upsert({
    where: { id: EVAL_USER.id },
    update: {},
    create: { ...EVAL_USER, role: 'STUDENT', dietPreference: null, institutionId: INSTITUTIONS.A.id },
  });

  const categoryId = (canteenId: string) => `${canteenId.slice(0, 24)}${'c'.repeat(12)}`;
  for (const c of CANTEENS) {
    const inst = INSTITUTIONS[c.institution];
    await prisma.canteen.upsert({
      where: { id: c.id },
      update: { isActive: true },
      create: { id: c.id, name: c.name, campus: 'Eval Campus', openingTime: c.open, closingTime: c.close, institutionId: inst.id },
    });
    await prisma.menuCategory.upsert({
      where: { id: categoryId(c.id) },
      update: {},
      create: { id: categoryId(c.id), canteenId: c.id, name: 'All day' },
    });
  }
  for (const i of ITEMS) {
    const canteen = CANTEENS.find((c) => c.name === i.canteen)!;
    const data = {
      canteenId: canteen.id,
      categoryId: categoryId(canteen.id),
      name: i.name,
      description: i.description ?? '',
      price: i.price,
      isVeg: i.isVeg,
      containsEgg: !!i.containsEgg,
      prepTimeMinutes: i.prep,
      isPopular: !!i.popular,
      isAvailable: true,
    };
    await prisma.menuItem.upsert({ where: { id: i.id }, update: data, create: { id: i.id, ...data } });
  }

  // Pickup slots for today and tomorrow (IST) at every canteen.
  for (const offset of [0, 1]) {
    const day = new Date(Date.now() + IST_OFFSET_MS + offset * 86_400_000).toISOString().slice(0, 10);
    const date = new Date(`${day}T00:00:00Z`);
    for (const c of CANTEENS.filter((x) => x.institution === 'A')) {
      await prisma.pickupSlot.createMany({
        data: slotTimes().map(([startTime, endTime]) => ({ canteenId: c.id, date, startTime, endTime, maxOrders: 25 })),
        skipDuplicates: true,
      });
    }
  }
}

if (require.main === module) {
  const url = process.env.EVAL_DATABASE_URL;
  if (!url || !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) {
    console.error('Set EVAL_DATABASE_URL to a throwaway LOCAL Postgres (migrations applied). Refusing to seed anything else.');
    process.exit(1);
  }
  process.env.DATABASE_URL = url;
  const { prisma } = require('../../src/config/database') as typeof import('../../src/config/database');
  seedEvalData(prisma)
    .then(() => console.log('Eval data seeded.'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
