-- schema.prisma gained these Razorpay/counter-price fields without a migration,
-- so a fresh `prisma migrate deploy` produced a database every order query
-- failed against. IF NOT EXISTS keeps this safe on databases that already got
-- the columns through `prisma db push`.

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'RAZORPAY';

-- AlterTable
ALTER TABLE "canteens" ADD COLUMN IF NOT EXISTS "razorpay_account_id" TEXT;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "counter_price" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pickup_code" TEXT,
ADD COLUMN IF NOT EXISTS "razorpay_order_id" TEXT,
ADD COLUMN IF NOT EXISTS "razorpay_payment_id" TEXT,
ADD COLUMN IF NOT EXISTS "razorpay_transfer_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "orders_razorpay_order_id_key" ON "orders"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "orders_razorpay_payment_id_key" ON "orders"("razorpay_payment_id");

-- Orders keep their row when a user goes away (SET NULL), matching schema.prisma
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_user_id_fkey";
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
