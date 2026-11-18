-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('ORDER_REVIEW', 'CANTEEN', 'APP_BUG', 'APP_IDEA', 'APP_PRAISE', 'APP_OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('RECEIVED', 'SEEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "FeedbackPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FeedbackVisibility" AS ENUM ('ADMIN_ONLY', 'VENDOR', 'PUBLIC');

-- CreateEnum
CREATE TYPE "FeedbackModeration" AS ENUM ('PENDING', 'CLEAN', 'FLAGGED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_user_id_fkey";

-- DropIndex
DROP INDEX "ratings_order_id_key";

-- AlterTable
ALTER TABLE "canteens" ADD COLUMN     "avg_rating" DECIMAL(2,1) NOT NULL DEFAULT 0,
ADD COLUMN     "rating_sum" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_ratings" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "rating_sum" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "feedback_nudge_at" TIMESTAMP(3),
ADD COLUMN     "feedback_nudge_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "point_transactions" ADD COLUMN     "feedback_id" TEXT;

-- AlterTable
ALTER TABLE "ratings" ADD COLUMN     "canteen_id" TEXT,
ADD COLUMN     "feedback_id" TEXT,
ADD COLUMN     "portion" INTEGER,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "taste" INTEGER,
ADD COLUMN     "value" INTEGER,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "kind" "FeedbackKind" NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'RECEIVED',
    "priority" "FeedbackPriority" NOT NULL DEFAULT 'NORMAL',
    "visibility" "FeedbackVisibility" NOT NULL DEFAULT 'ADMIN_ONLY',
    "moderation" "FeedbackModeration" NOT NULL DEFAULT 'PENDING',
    "user_id" TEXT,
    "institution_id" TEXT,
    "order_id" TEXT,
    "canteen_id" TEXT,
    "overall_rating" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body" TEXT,
    "body_redacted" TEXT,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "share_name_with_canteen" BOOLEAN NOT NULL DEFAULT false,
    "context_json" JSONB,
    "client_request_id" TEXT,
    "assigned_to" TEXT,
    "duplicate_of_id" TEXT,
    "changelog_entry_id" TEXT,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3),
    "sla_due_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_attachments" (
    "id" TEXT NOT NULL,
    "feedback_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "public_id" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_events" (
    "id" TEXT NOT NULL,
    "feedback_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "type" TEXT NOT NULL,
    "from_status" "FeedbackStatus",
    "to_status" "FeedbackStatus",
    "note" TEXT,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_reports" (
    "id" TEXT NOT NULL,
    "feedback_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changelog_entries" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "changelog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_identity_reveals" (
    "id" TEXT NOT NULL,
    "feedback_id" TEXT NOT NULL,
    "revealed_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_identity_reveals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_institution_id_status_created_at_idx" ON "feedback"("institution_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "feedback_canteen_id_created_at_idx" ON "feedback"("canteen_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_user_id_created_at_idx" ON "feedback"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_order_id_idx" ON "feedback"("order_id");

-- CreateIndex
CREATE INDEX "feedback_kind_created_at_idx" ON "feedback"("kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_user_id_client_request_id_key" ON "feedback"("user_id", "client_request_id");

-- CreateIndex
CREATE INDEX "feedback_attachments_feedback_id_idx" ON "feedback_attachments"("feedback_id");

-- CreateIndex
CREATE INDEX "feedback_events_feedback_id_created_at_idx" ON "feedback_events"("feedback_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_reports_feedback_id_reporter_id_key" ON "feedback_reports"("feedback_id", "reporter_id");

-- CreateIndex
CREATE INDEX "changelog_entries_published_at_idx" ON "changelog_entries"("published_at");

-- CreateIndex
CREATE INDEX "feedback_identity_reveals_feedback_id_idx" ON "feedback_identity_reveals"("feedback_id");

-- CreateIndex
CREATE UNIQUE INDEX "point_transactions_feedback_id_key" ON "point_transactions"("feedback_id");

-- CreateIndex
CREATE INDEX "ratings_menu_item_id_idx" ON "ratings"("menu_item_id");

-- CreateIndex
CREATE INDEX "ratings_canteen_id_created_at_idx" ON "ratings"("canteen_id", "created_at");

-- CreateIndex
CREATE INDEX "ratings_feedback_id_idx" ON "ratings"("feedback_id");

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "canteens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "canteens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_changelog_entry_id_fkey" FOREIGN KEY ("changelog_entry_id") REFERENCES "changelog_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_identity_reveals" ADD CONSTRAINT "feedback_identity_reveals_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index (not expressible in Prisma): one live ORDER_REVIEW per order.
CREATE UNIQUE INDEX "feedback_order_review_once" ON "feedback"("order_id") WHERE "kind" = 'ORDER_REVIEW' AND "deleted_at" IS NULL;
