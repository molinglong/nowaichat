-- 错题来源题库关联: 练习做错由 Question 同步转 StudyNote 的追溯字段
-- 软关联不设外键 —— 题库题目删除不影响已建错题卡;userId 联合索引供同题幂等查重
-- AlterTable
ALTER TABLE "StudyNote" ADD COLUMN "sourceQuestionId" TEXT;

-- CreateIndex
CREATE INDEX "StudyNote_userId_sourceQuestionId_idx" ON "StudyNote"("userId", "sourceQuestionId");
