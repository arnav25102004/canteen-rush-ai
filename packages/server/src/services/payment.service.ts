import { prisma } from '../config/database';
import { createRazorpayOrder as _createRazorpayOrder, verifyRazorpaySignature } from '../config/razorpay';

export async function createRazorpayOrder(amount: number, receipt: string) {
  return _createRazorpayOrder(amount, receipt);
}

export async function rechargeWallet(
  userId: string,
  amount: number,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string
) {
  const valid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature);
  if (!valid) throw new Error('Invalid payment signature');

  const wallet = await prisma.wallet.update({
    where: { userId },
    data: { balance: { increment: amount } },
  });

  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: 'RECHARGE',
      amount,
      balanceAfter: wallet.balance,
      description: `Wallet recharge via Razorpay`,
      razorpayPaymentId,
    },
  });

  return wallet;
}
