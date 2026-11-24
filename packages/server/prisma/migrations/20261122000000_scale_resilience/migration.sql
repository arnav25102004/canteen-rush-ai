-- Idempotent order placement
ALTER TABLE "orders" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- Transactional outbox
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- Order numbers come from a sequence, so the daily counter row is no longer a
-- write hot spot. Starting above every issued value keeps numbers unique.
CREATE SEQUENCE "order_number_seq";
SELECT setval('order_number_seq', GREATEST((SELECT COALESCE(MAX(seq), 0) FROM order_counters), 1));

-- Partial indexes for the hot queries (not expressible in schema.prisma)
CREATE INDEX "orders_active_slot_idx" ON "orders"("slot_id")
  WHERE "status" IN ('CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY');
CREATE INDEX "orders_unpaid_online_idx" ON "orders"("created_at")
  WHERE "status" = 'PENDING' AND "payment_status" = 'AWAITING_PAYMENT';
CREATE INDEX "notifications_user_recent_idx" ON "notifications"("user_id", "created_at" DESC)
  WHERE "user_id" IS NOT NULL;

-- Trigram search is an optimisation: a host without pg_trgm must not fail the deploy.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX "menu_items_name_trgm_idx" ON "menu_items" USING gin ("name" gin_trgm_ops) WHERE "is_available";
  CREATE INDEX "menu_items_description_trgm_idx" ON "menu_items" USING gin ("description" gin_trgm_ops) WHERE "is_available";
EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm unavailable; menu search runs without trigram indexes';
END $$;
