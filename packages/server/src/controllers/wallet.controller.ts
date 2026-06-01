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
  if (!amount || amount < 50) return res.status(400).json({ error: 'Minimum recharge is ₹50' });
  if (amount > 5000) return res.status(400).json({ error: 'Maximum recharge is ₹5000' });
  try {
   const receipt = `rch_${Date.now()}`;
    const order = await createRazorpayOrder(Number(amount), receipt);
    return res.json({ razorpayOrderId: order.id, amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err: any) {
    console.error('Wallet recharge error:', err?.error?.description || err?.message || 'Unknown error');
    return res.status(500).json({ error: 'Could not create payment order. Check Razorpay keys.' });
  }
}

export async function verifyRecharge(req: AuthRequest, res: Response) {
  const { razorpayOrderId, razorpayPaymentId, signature, amount } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !signature) {
    return res.status(400).json({ error: 'razorpayOrderId, razorpayPaymentId, signature required' });
  }
  try {
    const wallet = await rechargeWallet(req.user!.id, Number(amount), razorpayOrderId, razorpayPaymentId, signature);
    return res.json({ success: true, balance: wallet.balance });
  } catch (err: unknown) {
    return res.status(400).json({ error: (err as Error).message });
  }
}

export async function getSpendingSummary(req: AuthRequest, res: Response) {
  const { month } = req.query as Record<string, string>; // e.g. "2026-04"
  const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

  let start: Date;
  let end: Date;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 1);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id, type: 'DEBIT', createdAt: { gte: start, lt: end } },
    select: { amount: true, description: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const totalSpent = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const transactionCount = transactions.length;

  return res.json({ month: month || `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, totalSpent, transactionCount, transactions });
}
