import { Prisma } from '@prisma/client';

/** Average to one decimal, 0 when there are no ratings. Half-up on the stored sum/count. */
export function computeAvg(sum: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round((sum / count) * 10) / 10;
}

type Tx = Prisma.TransactionClient;

/**
 * Move a MenuItem's or Canteen's rating aggregates by (dSum, dCount) using increments, then
 * derive avgRating from the resulting sum and count. The row lock taken by the first update is
 * held until commit, so concurrent writers cannot derive the average from stale values.
 */
export async function applyItemDelta(tx: Tx, menuItemId: string, dSum: number, dCount: number) {
  if (dSum === 0 && dCount === 0) return;
  const row = await tx.menuItem.update({
    where: { id: menuItemId },
    data: { ratingSum: { increment: dSum }, totalRatings: { increment: dCount } },
    select: { ratingSum: true, totalRatings: true },
  });
  await tx.menuItem.update({
    where: { id: menuItemId },
    data: { avgRating: computeAvg(row.ratingSum, row.totalRatings) },
  });
}

export async function applyCanteenDelta(tx: Tx, canteenId: string, dSum: number, dCount: number) {
  if (dSum === 0 && dCount === 0) return;
  const row = await tx.canteen.update({
    where: { id: canteenId },
    data: { ratingSum: { increment: dSum }, totalRatings: { increment: dCount } },
    select: { ratingSum: true, totalRatings: true },
  });
  await tx.canteen.update({
    where: { id: canteenId },
    data: { avgRating: computeAvg(row.ratingSum, row.totalRatings) },
  });
}
