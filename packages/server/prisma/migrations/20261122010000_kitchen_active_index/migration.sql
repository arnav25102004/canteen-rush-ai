-- Kitchen board: find a canteen's open orders without scanning its order history.
CREATE INDEX "orders_kitchen_active_idx" ON "orders"("canteen_id", "created_at", "id")
  WHERE "status" IN ('PENDING', 'CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY');
