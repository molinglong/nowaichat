-- 写作画布: 豆包式「帮我写作」工作区(/write)的文档存储,
-- 正文生成走 /api/write/generate(流式),CRUD 走 /api/write/docs。
-- charCount 冗余存储,列表页免拉全文显示字数。

-- CreateTable
CREATE TABLE "WriteDoc" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '未命名',
    "content" TEXT NOT NULL DEFAULT '',
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WriteDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WriteDoc_userId_updatedAt_idx" ON "WriteDoc"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "WriteDoc" ADD CONSTRAINT "WriteDoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
