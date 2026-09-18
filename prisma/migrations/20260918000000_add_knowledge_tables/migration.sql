-- 学习知识库:课本/资料文档与检索切块
-- KnowledgeDoc: 一本课本/一份资料的元数据;KnowledgeChunk: 按章节切块的
-- 知识文本,是检索的最小单元。切块文本保留 LaTeX 原样,栏目(例题/练习)
-- 以【例题】【练习】前缀内联;userId 冗余存储便于按用户过滤检索。

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "publisher" TEXT,
    "grade" TEXT,
    "sourceUploadId" TEXT,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chapter" TEXT,
    "section" TEXT,
    "subsection" TEXT,
    "heading" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDoc_userId_createdAt_idx" ON "KnowledgeDoc"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_userId_docId_sortOrder_idx" ON "KnowledgeChunk"("userId", "docId", "sortOrder");

-- 知识切块全文检索索引: pg_trgm GIN,支持 content ILIKE '%kw%' 任意位置命中
-- (pg_trgm 扩展已在 20260830213000_add_message_content_trgm 中启用,此处幂等兜底)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "KnowledgeChunk_content_trgm_idx"
  ON "KnowledgeChunk" USING GIN (content gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "KnowledgeDoc" ADD CONSTRAINT "KnowledgeDoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
