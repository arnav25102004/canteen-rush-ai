import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
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

export async function getSpendingSummary(req: AuthRequest, res: Response) {
  const { month } = req.query as Record<string, string>;
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

  return res.json({
    month: month || `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
    totalSpent,
    transactionCount,
    transactions,
  });
}
