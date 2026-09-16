-- CreateTable
CREATE TABLE "CustomModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "baseURL" TEXT NOT NULL,
    "apiKey" TEXT,
    "keyProvider" TEXT,
    "contextWindow" INTEGER NOT NULL DEFAULT 32768,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsFiles" BOOLEAN NOT NULL DEFAULT false,
    "supportsReasoning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomModel_userId_modelId_key" ON "CustomModel"("userId", "modelId");

-- CreateIndex
CREATE INDEX "CustomModel_userId_idx" ON "CustomModel"("userId");
