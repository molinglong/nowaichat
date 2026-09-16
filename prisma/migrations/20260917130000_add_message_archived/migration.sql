-- C 分支轻量版: 编辑消息归档代替删除
-- archived 标记归档行;archivedRoot 记录被编辑消息 id,回看端点按它查询旧版本链。

-- AlterTable
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "archivedRoot" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_archivedRoot_idx" ON "Message"("archivedRoot");
