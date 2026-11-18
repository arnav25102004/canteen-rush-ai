-- AlterTable
ALTER TABLE "point_transactions" ADD COLUMN "helpful_feedback_id" TEXT;

-- AlterTable
ALTER TABLE "changelog_entries" ADD COLUMN "canteen_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "point_transactions_helpful_feedback_id_key" ON "point_transactions"("helpful_feedback_id");
