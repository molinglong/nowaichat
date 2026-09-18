-- 题库表：题目资产层(出题 API 确认入库 / 未来试卷导入共用)
-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "topic" TEXT,
    "kind" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "source" TEXT NOT NULL DEFAULT 'ai_generated',
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Question_userId_subject_createdAt_idx" ON "Question"("userId", "subject", "createdAt");

-- CreateIndex
CREATE INDEX "Question_userId_topic_idx" ON "Question"("userId", "topic");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
