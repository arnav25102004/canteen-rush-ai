-- Add ban fields to User table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_banned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ban_reason" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "banned_at" TIMESTAMP(3);

-- Make Order.userId nullable (for account deletion anonymization)
ALTER TABLE "orders" ALTER COLUMN "user_id" DROP NOT NULL;
