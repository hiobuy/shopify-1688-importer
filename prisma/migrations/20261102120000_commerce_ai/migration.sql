-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "aiShopDomain" TEXT;

-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "AiJob" ADD COLUMN "remoteJobId" TEXT;
ALTER TABLE "AiJob" ADD COLUMN "requestJson" TEXT;
ALTER TABLE "AiJob" ADD COLUMN "nextPollAt" DATETIME;
ALTER TABLE "AiJob" ADD COLUMN "errorCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AiJob_idempotencyKey_key" ON "AiJob"("idempotencyKey");
