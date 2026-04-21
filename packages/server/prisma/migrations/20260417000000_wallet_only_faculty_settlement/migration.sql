-- Migration: wallet_only_faculty_settlement
-- Adds FACULTY role, wallet-only payment, faculty slot reservation, department field, daily settlements

-- 1. Add FACULTY to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FACULTY';

-- 2. Add department column to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "department" TEXT;

-- 3. Add faculty_reserved column to pickup_slots
ALTER TABLE "pickup_slots" ADD COLUMN IF NOT EXISTS "faculty_reserved" INTEGER NOT NULL DEFAULT 3;

-- 4. Remove old payment method values from any existing orders (set to WALLET)
--    First, drop the default, change existing rows, then alter the enum
UPDATE "orders" SET "payment_method" = 'WALLET' WHERE "payment_method" IS NULL OR "payment_method" != 'WALLET';

-- 5. Change PaymentMethod enum to WALLET only
--    PostgreSQL doesn't support removing enum values directly.
--    We rename the old enum and create a new one.
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
CREATE TYPE "PaymentMethod" AS ENUM ('WALLET');
ALTER TABLE "orders" ALTER COLUMN "payment_method" TYPE "PaymentMethod" USING 'WALLET'::"PaymentMethod";
ALTER TABLE "orders" ALTER COLUMN "payment_method" SET DEFAULT 'WALLET'::"PaymentMethod";
ALTER TABLE "orders" ALTER COLUMN "payment_method" SET NOT NULL;
DROP TYPE "PaymentMethod_old";

-- 6. Create daily_settlements table
CREATE TABLE IF NOT EXISTS "daily_settlements" (
  "id"            TEXT NOT NULL,
  "canteen_id"    TEXT NOT NULL,
  "date"          DATE NOT NULL,
  "total_orders"  INTEGER NOT NULL,
  "gross_amount"  DECIMAL(10,2) NOT NULL,
  "platform_fee"  DECIMAL(10,2) NOT NULL,
  "net_amount"    DECIMAL(10,2) NOT NULL,
  "is_paid"       BOOLEAN NOT NULL DEFAULT false,
  "paid_at"       TIMESTAMP(3),
  "paid_by"       TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "daily_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_settlements_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "canteens"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_settlements_canteen_id_date_key" UNIQUE ("canteen_id", "date")
);
