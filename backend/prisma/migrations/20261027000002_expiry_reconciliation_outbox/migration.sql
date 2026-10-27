CREATE TYPE "OutboxEventType" AS ENUM ('PAYMENT_RECONCILIATION_REQUIRED');
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'DEAD');
CREATE TYPE "ReconciliationCaseStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" "OutboxEventType" NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReconciliationCase" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "outboxEventId" TEXT NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReconciliationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReconciliationCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutboxEvent_eventKey_key" ON "OutboxEvent"("eventKey");
CREATE INDEX "OutboxEvent_status_availableAt_createdAt_idx" ON "OutboxEvent"("status", "availableAt", "createdAt");
CREATE INDEX "OutboxEvent_aggregateId_createdAt_idx" ON "OutboxEvent"("aggregateId", "createdAt");
CREATE UNIQUE INDEX "ReconciliationCase_providerEventId_key" ON "ReconciliationCase"("providerEventId");
CREATE UNIQUE INDEX "ReconciliationCase_outboxEventId_key" ON "ReconciliationCase"("outboxEventId");
CREATE INDEX "ReconciliationCase_orderId_status_createdAt_idx" ON "ReconciliationCase"("orderId", "status", "createdAt");

ALTER TABLE "ReconciliationCase"
    ADD CONSTRAINT "ReconciliationCase_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "CinemaOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReconciliationCase"
    ADD CONSTRAINT "ReconciliationCase_outboxEventId_fkey"
    FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
