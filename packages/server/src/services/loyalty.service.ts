import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

const POINTS_PER_RUPEE = 0.1; // ₹10 = 1 point
const DOUBLE_POINTS_BEFORE_HOUR = 9; // before 9 AM

const REDEMPTION_TIERS = [
  { points: 200,  discount: 20  },
  { points: 500,  discount: 60  },
  { points: 1000, discount: 120 },
];

export function getRedemptionTiers() {
  return REDEMPTION_TIERS;
}

export async function validatePointsRedemption(
  userId: string,
  pointsToRedeem: number
): Promise<{ valid: boolean; discountAmount: number; error?: string }> {
  if (pointsToRedeem === 0) return { valid: true, discountAmount: 0 };

  const tier = REDEMPTION_TIERS.find((t) => t.points === pointsToRedeem);
  if (!tier) {
    return {
      valid: false,
      discountAmount: 0,
      error: `Points must be redeemed in exact tiers: ${REDEMPTION_TIERS.map((t) => t.points).join(', ')}`,
    };
  }

  const loyaltyAccount = await prisma.loyaltyAccount.findUnique({ where: { userId } });
  if (!loyaltyAccount || loyaltyAccount.totalPoints < pointsToRedeem) {
    return {
      valid: false,
      discountAmount: 0,
      error: `Insufficient points. You have ${loyaltyAccount?.totalPoints || 0} points, need ${pointsToRedeem}.`,
    };
  }

  return { valid: true, discountAmount: tier.discount };
}

/**
 * Spend points inside the caller's order transaction. The conditional update
 * makes concurrent orders unable to spend the same points twice.
 */
export async function redeemPoints(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  pointsToRedeem: number,
  discountAmount: number
): Promise<void> {
  const { count } = await tx.loyaltyAccount.updateMany({
    where: { userId, totalPoints: { gte: pointsToRedeem } },
    data: { totalPoints: { decrement: pointsToRedeem }, totalSaved: { increment: discountAmount } },
  });
  if (count === 0) throw new Error('Not enough loyalty points');

  const account = await tx.loyaltyAccount.findUniqueOrThrow({ where: { userId } });
  await tx.pointTransaction.create({
    data: {
      loyaltyId: account.id,
      orderId,
      type: 'REDEEMED',
      points: -pointsToRedeem,
      description: `Redeemed ${pointsToRedeem} points for ₹${discountAmount} discount`,
      balanceAfter: account.totalPoints,
    },
  });
}

/** Give back points spent on an order that was cancelled. */
export async function refundRedeemedPoints(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  points: number,
  discountAmount: number,
  orderNumber: string
): Promise<void> {
  const account = await tx.loyaltyAccount.findUnique({ where: { userId } });
  if (!account || points <= 0) return;
  const updated = await tx.loyaltyAccount.update({
    where: { id: account.id },
    data: { totalPoints: { increment: points }, totalSaved: { decrement: discountAmount } },
  });
  await tx.pointTransaction.create({
    data: {
      loyaltyId: account.id,
      orderId,
      type: 'BONUS',
      points,
      description: `Returned ${points} points for cancelled Order #${orderNumber}`,
      balanceAfter: updated.totalPoints,
    },
  });
}

export async function awardPointsForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: { include: { loyaltyAccount: true } } },
  });

  if (!order || order.status !== 'PICKED_UP') return;
  if (order.pointsRedeemed > 0) return; // don't award on redemption orders
  // Accounts are anonymised (not deleted) so userId/user survive — but a
  // deleted user's loyaltyAccount was removed on deletion; don't resurrect it.
  if (!order.userId || !order.user || order.user.isDeleted) return;
  const { userId, user } = order;

  const orderHour = order.createdAt.getHours();
  const isDoublePoints = orderHour < DOUBLE_POINTS_BEFORE_HOUR;
  const basePoints = Math.max(1, Math.floor(Number(order.subtotal) * POINTS_PER_RUPEE));
  const pointsToAward = isDoublePoints ? basePoints * 2 : basePoints;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  let loyaltyAccount = user.loyaltyAccount;
  if (!loyaltyAccount) {
    loyaltyAccount = await prisma.loyaltyAccount.create({
      data: { userId, totalPoints: 0, lifetimePoints: 0, totalSaved: 0 },
    });
  }

  const newBalance = loyaltyAccount.totalPoints + pointsToAward;

  await prisma.$transaction([
    prisma.loyaltyAccount.update({
      where: { id: loyaltyAccount.id },
      data: {
        totalPoints: { increment: pointsToAward },
        lifetimePoints: { increment: pointsToAward },
      },
    }),
    prisma.pointTransaction.create({
      data: {
        loyaltyId: loyaltyAccount.id,
        orderId: order.id,
        type: 'EARNED',
        points: pointsToAward,
        description: isDoublePoints
          ? `2× bonus: Earned ${pointsToAward} pts for Order #${order.orderNumber} (early bird!)`
          : `Earned ${pointsToAward} pts for Order #${order.orderNumber}`,
        balanceAfter: newBalance,
        expiresAt,
      },
    }),
    prisma.order.update({ where: { id: order.id }, data: { pointsEarned: pointsToAward } }),
  ]);
}

export async function getLoyaltyAccount(userId: string) {
  return prisma.loyaltyAccount.findUnique({
    where: { userId },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });
}
