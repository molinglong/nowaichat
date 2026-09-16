-- E 对比模式投票: 用户对某一轮对比(groupId)选出更满意的模型回答。
-- 每轮一票(可改票 = upsert);会话删除时级联清理。

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompareVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "votedModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompareVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CompareVote_userId_idx" ON "CompareVote"("userId");

-- CreateForeignKey
ALTER TABLE "CompareVote" ADD CONSTRAINT "CompareVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompareVote" ADD CONSTRAINT "CompareVote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 每轮一票
CREATE UNIQUE INDEX IF NOT EXISTS "CompareVote_conversationId_groupId_key" ON "CompareVote"("conversationId", "groupId");
