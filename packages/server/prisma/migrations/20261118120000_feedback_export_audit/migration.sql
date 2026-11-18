-- CreateTable
CREATE TABLE "feedback_export_audits" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "filters_json" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_export_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_export_audits_actor_id_created_at_idx" ON "feedback_export_audits"("actor_id", "created_at");
