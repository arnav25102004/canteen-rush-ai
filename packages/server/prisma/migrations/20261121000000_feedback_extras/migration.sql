-- AlterTable
ALTER TABLE "feedback" ADD COLUMN "vote_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "feedback_attachments" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PHOTO';

-- CreateTable
CREATE TABLE "feedback_idea_votes" (
    "feedback_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_idea_votes_pkey" PRIMARY KEY ("feedback_id","user_id")
);

-- AddForeignKey
ALTER TABLE "feedback_idea_votes" ADD CONSTRAINT "feedback_idea_votes_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
