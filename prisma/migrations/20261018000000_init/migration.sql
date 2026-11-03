-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "apiKeyEncrypted" TEXT,
    "keyConfigured" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'unconfigured',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" TEXT NOT NULL DEFAULT '0.14',
    "multiplier" TEXT NOT NULL DEFAULT '2.5',
    "rounding" TEXT NOT NULL DEFAULT 'two_decimals',
    "publishStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "sourceJson" TEXT NOT NULL,
    "editorJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourcePlatform" TEXT NOT NULL DEFAULT '1688',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "publishStatus" TEXT NOT NULL,
    "productId" TEXT,
    "productHandle" TEXT NOT NULL,
    "error" TEXT,
    "warnings" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" DATETIME,
    "lockToken" TEXT,
    "snapshotJson" TEXT NOT NULL,
    "filesJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportRecord_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "capability" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "inputJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "error" TEXT,
    "shouldFail" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "readyAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiJob_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Draft_shop_updatedAt_idx" ON "Draft"("shop", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRecord_draftId_key" ON "ImportRecord"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRecord_productHandle_key" ON "ImportRecord"("productHandle");

-- CreateIndex
CREATE INDEX "ImportRecord_shop_createdAt_idx" ON "ImportRecord"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_shop_status_idx" ON "AiJob"("shop", "status");

-- CreateIndex
CREATE INDEX "Asset_shop_draftId_idx" ON "Asset"("shop", "draftId");
