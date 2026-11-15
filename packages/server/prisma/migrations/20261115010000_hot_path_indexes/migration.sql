-- Additive, idempotent indexes (no data changes).
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX IF NOT EXISTS "orders_canteen_id_created_at_idx" ON "orders"("canteen_id", "created_at");
CREATE INDEX IF NOT EXISTS "orders_payment_status_created_at_idx" ON "orders"("payment_status", "created_at");
