ALTER TABLE "orders" ADD COLUMN     "feedback_nudge2_sent_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_feedback_nudge_sent_at_feedback_nudge_at_idx" ON "orders"("feedback_nudge_sent_at", "feedback_nudge_at");
