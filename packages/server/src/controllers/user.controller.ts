import { Response } from 'express';
import { prisma } from '../config/database';
import { deleteFirebaseUser } from '../config/firebase';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { anonymiseUserFeedback } from '../services/feedback.service';
import { invalidateAuthUser } from '../services/authUser.service';
import { disconnectUser } from '../socket/orderSocket';

// DPDPA-style deletion: anonymise rather than hard-delete. Orders reference
// this user for vendor settlement/dispute records, so the row must survive —
// only the personally identifying fields are scrubbed.
export async function deleteAccount(req: AuthRequest, res: Response) {
  const userId = req.user!.id;
  const firebaseUid = req.user!.firebaseUid;

  try {
    await prisma.$transaction(async (tx) => {
      // Notifications, favorites and ratings carry no settlement value once
      // the account is gone — delete them outright.
      await tx.notification.deleteMany({ where: { userId } });
      await tx.favorite.deleteMany({ where: { userId } });
      // Ratings and feedback are anonymised, not deleted: the numbers stay so item and
      // canteen averages remain correct; the link to the person and any free text go.
      await anonymiseUserFeedback(tx, userId);

      // AI assistant data: conversations (messages and proposals cascade or are
      // removed here), usage rows and reports. The ledger keeps no content, only
      // counts, so it stays with the user link removed.
      await tx.assistantProposal.deleteMany({ where: { userId } });
      await tx.assistantReport.deleteMany({ where: { userId } });
      await tx.assistantConversation.deleteMany({ where: { userId } });
      await tx.assistantDailyUsage.deleteMany({ where: { scope: userId } });
      await tx.assistantCallLog.updateMany({ where: { userId }, data: { userId: null } });

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

      // Scrub PII, keep the row (and its order history) for vendor settlement
      // and dispute records. email stays unique so the slot can't be reused;
      // firebaseUid stays unique too since the Firebase account is deleted next.
      await tx.user.update({
        where: { id: userId },
        data: {
          name: 'Deleted User',
          email: `deleted_${userId}@campuskhana.invalid`,
          phone: null,
          avatarUrl: null,
          fcmToken: null,
          firebaseUid: `deleted_${userId}`,
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    });

    await invalidateAuthUser(firebaseUid);
    disconnectUser(req.io, userId);

    // Delete from Firebase Auth after DB anonymisation succeeds
    try {
      await deleteFirebaseUser(firebaseUid);
    } catch (fbErr) {
      // Log but don't fail — DB record is already anonymised
      logger.warn('Firebase user deletion failed after DB anonymisation', { firebaseUid, err: fbErr });
    }

    logger.info('Account deleted (anonymised)', { userId });
    return res.json({ success: true, message: 'Account deleted.' });
  } catch (err) {
    logger.error('Account deletion failed', { userId, err });
    return res.status(500).json({ error: 'Failed to delete account. Please try again.' });
  }
}
