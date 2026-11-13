-- CreateTable
CREATE TABLE "order_counters" (
    "date" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("date")
);
