-- Rename imageModel defaults and add ImageModel table
ALTER TABLE "User" ADD COLUMN "imageModel_new" TEXT NOT NULL DEFAULT 'builtin:wanx2.1-t2i-turbo';
UPDATE "User" SET "imageModel_new" = 'builtin:' || "imageModel" WHERE "imageModel" IS NOT NULL;
ALTER TABLE "User" DROP COLUMN "imageModel";
ALTER TABLE "User" RENAME COLUMN "imageModel_new" TO "imageModel";

ALTER TABLE "GeneratedImage" ADD COLUMN "model_new" TEXT NOT NULL DEFAULT 'builtin:wanx2.1-t2i-turbo';
UPDATE "GeneratedImage" SET "model_new" = 'builtin:' || "model" WHERE "model" IS NOT NULL;
ALTER TABLE "GeneratedImage" DROP COLUMN "model";
ALTER TABLE "GeneratedImage" RENAME COLUMN "model_new" TO "model";

CREATE TABLE "ImageModel" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "baseURL" TEXT NOT NULL,
  "apiKeySource" TEXT NOT NULL DEFAULT 'provider',
  "apiKey" TEXT,
  "keyProvider" TEXT,
  "contextWindow" INTEGER NOT NULL DEFAULT 2048,
  "supportsSize" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ImageModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ImageModel_userId_modelId_key" ON "ImageModel"("userId", "modelId");
CREATE INDEX "ImageModel_userId_idx" ON "ImageModel"("userId");
