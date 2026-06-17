/*
  Warnings:

  - The values [PENDING] on the enum `PaymentStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `razorpay_order_id` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `razorpay_payment_id` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `razorpay_payment_id` on the `wallet_transactions` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PointTransactionType" AS ENUM ('EARNED', 'REDEEMED', 'EXPIRED', 'BONUS');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'UPI_DIRECT';

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('AWAITING_PAYMENT', 'PENDING_VERIFICATION', 'VERIFIED', 'PAID', 'REFUNDED', 'EXPIRED', 'FAILED');
ALTER TABLE "orders" ALTER COLUMN "payment_status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "payment_status" TYPE "PaymentStatus_new" USING ("payment_status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";
ALTER TABLE "orders" ALTER COLUMN "payment_status" SET DEFAULT 'AWAITING_PAYMENT';
COMMIT;

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'CREDIT';

-- AlterTable
ALTER TABLE "canteens" ADD COLUMN     "vendor_upi_id" TEXT,
ADD COLUMN     "vendor_upi_name" TEXT;

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "razorpay_order_id",
DROP COLUMN "razorpay_payment_id",
ADD COLUMN     "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "payment_claimed_at" TIMESTAMP(3),
ADD COLUMN     "payment_verified_at" TIMESTAMP(3),
ADD COLUMN     "points_earned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_redeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "upi_order_note" TEXT,
ALTER COLUMN "payment_status" SET DEFAULT 'AWAITING_PAYMENT',
ALTER COLUMN "payment_method" SET DEFAULT 'UPI_DIRECT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "order_strikes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "strike_banned_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "wallet_transactions" DROP COLUMN "razorpay_payment_id";

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "lifetime_points" INTEGER NOT NULL DEFAULT 0,
    "total_saved" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_transactions" (
    "id" TEXT NOT NULL,
    "loyalty_id" TEXT NOT NULL,
    "order_id" TEXT,
    "type" "PointTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_user_id_key" ON "loyalty_accounts"("user_id");

-- CreateIndex
CREATE INDEX "point_transactions_loyalty_id_created_at_idx" ON "point_transactions"("loyalty_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_canteen_id_payment_status_idx" ON "orders"("canteen_id", "payment_status");

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_loyalty_id_fkey" FOREIGN KEY ("loyalty_id") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
