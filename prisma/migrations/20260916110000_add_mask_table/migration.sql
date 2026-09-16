-- CreateEnum-less mask table (custom masks, P1)
CREATE TABLE IF NOT EXISTS "Mask" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatar" TEXT NOT NULL DEFAULT '🎭',
  "description" TEXT NOT NULL DEFAULT '',
  "systemPrompt" TEXT NOT NULL,
  "fewShot" JSONB,
  "stylePreset" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Mask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Mask_userId_updatedAt_idx" ON "Mask"("userId", "updatedAt");

ALTER TABLE "Mask" ADD CONSTRAINT "Mask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
