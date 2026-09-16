-- CreateTable
CREATE TABLE "ProviderModelOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "contextWindow" INTEGER NOT NULL DEFAULT 32768,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsFiles" BOOLEAN NOT NULL DEFAULT false,
    "supportsReasoning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderModelOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderModelOverride_userId_idx" ON "ProviderModelOverride"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderModelOverride_userId_provider_modelId_key" ON "ProviderModelOverride"("userId", "provider", "modelId");

-- AddForeignKey
ALTER TABLE "ProviderModelOverride" ADD CONSTRAINT "ProviderModelOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
