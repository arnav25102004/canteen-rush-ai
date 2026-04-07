import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createRazorpayOrder, rechargeWallet } from '../services/payment.service';
import { parsePagination } from '../utils/helpers';

export async function getWallet(req: AuthRequest, res: Response) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId: req.user!.id },
    select: { id: true, balance: true, updatedAt: true },
  });
  return res.json({ wallet });
}

export async function getTransactions(req: AuthRequest, res: Response) {
  const { page, limit } = req.query as Record<string, string>;
  const { skip, take, page: p, limit: l } = parsePagination(page, limit);

  const wallet = await prisma.wallet.findUnique({
    where: { userId: req.user!.id },
    select: { id: true },
  });
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
  ]);

  return res.json({ transactions, total, page: p, limit: l });
}

export async function initiateRecharge(req: AuthRequest, res: Response) {
  const { amount } = req.body;
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum recharge is ₹10' });

  const receipt = `recharge_${req.user!.id}_${Date.now()}`;
  const order = await createRazorpayOrder(amount, receipt);
  return res.json({ razorpayOrderId: order.id, amount, currency: 'INR' });
}

export async function verifyRecharge(req: AuthRequest, res: Response) {
  const { razorpayOrderId, razorpayPaymentId, signature, amount } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !signature) {
    return res.status(400).json({ error: 'razorpayOrderId, razorpayPaymentId, signature required' });
  }

  try {
    const wallet = await rechargeWallet(req.user!.id, amount, razorpayOrderId, razorpayPaymentId, signature);
    return res.json({ success: true, balance: wallet.balance });
  } catch (err: unknown) {
    return res.status(400).json({ error: (err as Error).message });
  }
}
