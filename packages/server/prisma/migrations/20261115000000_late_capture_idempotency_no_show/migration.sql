-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'NO_SHOW';

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN "razorpay_payment_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_razorpay_payment_id_key" ON "wallet_transactions"("razorpay_payment_id");
