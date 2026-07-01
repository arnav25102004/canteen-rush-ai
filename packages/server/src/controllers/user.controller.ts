import { Response } from 'express';
import { prisma } from '../config/database';
import { firebaseAdmin } from '../config/firebase';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export async function deleteAccount(req: AuthRequest, res: Response) {
  const userId = req.user!.id;
  const firebaseUid = req.user!.firebaseUid;

  try {
    await prisma.$transaction(async (tx) => {
      // Remove PII from order history — keep order records for vendor settlement
      await tx.order.updateMany({
        where: { userId },
        data: { userId: null },
      });

      // Delete user-specific data
      await tx.notification.deleteMany({ where: { userId } });
      await tx.favorite.deleteMany({ where: { userId } });
      await tx.rating.deleteMany({ where: { userId } });

      const loyaltyAccount = await tx.loyaltyAccount.findUnique({ where: { userId } });
      if (loyaltyAccount) {
        await tx.pointTransaction.deleteMany({ where: { loyaltyId: loyaltyAccount.id } });
        await tx.loyaltyAccount.delete({ where: { userId } });
      }

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (wallet) {
        await tx.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
        await tx.wallet.delete({ where: { userId } });
      }

      await tx.user.delete({ where: { id: userId } });
    });

    // Delete from Firebase Auth after DB cleanup succeeds
    try {
      await firebaseAdmin.auth().deleteUser(firebaseUid);
    } catch (fbErr) {
      // Log but don't fail — DB record is already removed
      logger.warn('Firebase user deletion failed after DB cleanup', { firebaseUid, err: fbErr });
    }

    logger.info('Account deleted', { userId });
    return res.json({ success: true, message: 'Account deleted.' });
  } catch (err) {
    logger.error('Account deletion failed', { userId, err });
    return res.status(500).json({ error: 'Failed to delete account. Please try again.' });
  }
}
