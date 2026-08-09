-- Add anonymisation fields to User table (DPDPA-style account deletion:
-- scrub PII, keep the row for order/settlement history, instead of hard delete)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
