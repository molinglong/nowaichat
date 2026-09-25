-- 代码文档表(CodeDoc):独立于写作画布的代码文档存储
-- 正文为代码文本,language 标识语言(typescript/python/...)
-- CRUD 走 /api/code/docs;AI 改代码片段走 code_edit 工具 + Diff 审查(客户端拦截)
-- charCount 冗余存储:列表页免拉全文即可显示字数
-- 全部 IF NOT EXISTS / 存在性守卫:本地库已 db push 建表的场景下 migrate deploy 可安全跳过
CREATE TABLE IF NOT EXISTS "CodeDoc" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '未命名',
    "content" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'typescript',
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeDoc_pkey" PRIMARY KEY ("id")
);

-- 列表查询:按用户过滤 + 更新时间排序
CREATE INDEX IF NOT EXISTS "CodeDoc_userId_updatedAt_idx" ON "CodeDoc"("userId", "updatedAt");

-- 外键:随用户级联删除(约束无 IF NOT EXISTS,查 catalog 后动态执行)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CodeDoc_userId_fkey') THEN
        ALTER TABLE "CodeDoc" ADD CONSTRAINT "CodeDoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 代码文档归属对话:write_code 工具创建时记录来源会话,代码列表按会话聚合展示
-- (可空:存量文档无归属,不出现在任何会话列表,但 code_edit 仍可按 docId 修改)
ALTER TABLE "CodeDoc" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

-- 会话内列表查询:按会话过滤 + 更新时间排序
CREATE INDEX IF NOT EXISTS "CodeDoc_conversationId_updatedAt_idx" ON "CodeDoc"("conversationId", "updatedAt");
