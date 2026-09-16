-- CreateTable
CREATE TABLE "UploadFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "parseStatus" TEXT NOT NULL,
    "parseError" TEXT,
    "parseText" TEXT,
    "pageCount" INTEGER,
    "charCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadFile_fileName_key" ON "UploadFile"("fileName");

-- CreateIndex
CREATE INDEX "UploadFile_userId_createdAt_idx" ON "UploadFile"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UploadFile" ADD CONSTRAINT "UploadFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

