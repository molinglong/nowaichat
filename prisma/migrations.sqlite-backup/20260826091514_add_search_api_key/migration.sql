-- CreateTable
CREATE TABLE "SearchApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SearchApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SearchApiKey_userId_idx" ON "SearchApiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchApiKey_userId_engine_key" ON "SearchApiKey"("userId", "engine");