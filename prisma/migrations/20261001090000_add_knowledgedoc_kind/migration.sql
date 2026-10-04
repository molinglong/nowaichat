-- KnowledgeDoc.kind: 课本/资料分层检索标准
-- textbook=课本/教材原文,material=资料(答题模板/提纲/讲义);检索可按 kind 过滤
ALTER TABLE "KnowledgeDoc" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'textbook';

-- 存量回填:标题含资料关键词的判为 material,其余保持 textbook
UPDATE "KnowledgeDoc"
SET "kind" = 'material'
WHERE title ~ '答题模板|提纲|秘籍|讲义|笔记';
