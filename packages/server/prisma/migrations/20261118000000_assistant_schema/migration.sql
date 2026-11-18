-- CreateEnum
CREATE TYPE "AssistantMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AssistantProposalStatus" AS ENUM ('PROPOSED', 'HANDED_OFF', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AssistantReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refs" JSONB NOT NULL DEFAULT '{}',
    "busy_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "AssistantMessageRole" NOT NULL,
    "text" TEXT NOT NULL,
    "cards" JSONB,
    "chips" JSONB,
    "client_turn_id" TEXT,
    "reply_to_id" TEXT,
    "outcome" TEXT,
    "reported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_proposals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "canteen_id" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "slot_id" TEXT,
    "status" "AssistantProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "handed_off_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_call_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "conversation_id" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "args_sha256" TEXT,
    "grounding_drops" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_daily_usage" (
    "scope" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "assistant_daily_usage_pkey" PRIMARY KEY ("scope","day")
);

-- CreateTable
CREATE TABLE "assistant_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message_id" TEXT,
    "reason" TEXT,
    "status" "AssistantReportStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_user_id_updated_at_idx" ON "assistant_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "assistant_messages_conversation_id_created_at_idx" ON "assistant_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_messages_created_at_idx" ON "assistant_messages"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_messages_conversation_id_client_turn_id_role_key" ON "assistant_messages"("conversation_id", "client_turn_id", "role");

-- CreateIndex
CREATE INDEX "assistant_proposals_user_id_status_idx" ON "assistant_proposals"("user_id", "status");

-- CreateIndex
CREATE INDEX "assistant_proposals_conversation_id_idx" ON "assistant_proposals"("conversation_id");

-- CreateIndex
CREATE INDEX "assistant_proposals_created_at_idx" ON "assistant_proposals"("created_at");

-- CreateIndex
CREATE INDEX "assistant_call_logs_created_at_idx" ON "assistant_call_logs"("created_at");

-- CreateIndex
CREATE INDEX "assistant_call_logs_user_id_created_at_idx" ON "assistant_call_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_reports_status_created_at_idx" ON "assistant_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "assistant_reports_message_id_idx" ON "assistant_reports"("message_id");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_reports" ADD CONSTRAINT "assistant_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_reports" ADD CONSTRAINT "assistant_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

