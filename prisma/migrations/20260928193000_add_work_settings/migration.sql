-- 写作作品(Work)与设定集(WorkSetting):长篇写作的上下文容器。
-- 设定条目挂作品层,作品下可归属多篇文档(章节);生成时按预算注入 system prompt,解跨章吃书。
-- 全部 IF NOT EXISTS / 存在性守卫:本地库已手动执行或 db push 过的场景下 migrate deploy 可安全跳过。
CREATE TABLE IF NOT EXISTS "Work" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '未命名作品',
    "description" TEXT NOT NULL DEFAULT '',
    "settingsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Work_pkey" PRIMARY KEY ("id")
);

-- 作品列表查询:按用户过滤 + 更新时间排序
CREATE INDEX IF NOT EXISTS "Work_userId_updatedAt_idx" ON "Work"("userId", "updatedAt");

-- 外键:随用户级联删除
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Work_userId_fkey') THEN
        ALTER TABLE "Work" ADD CONSTRAINT "Work_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 设定条目:分类 + 标题 + 别名(英文逗号分隔,聊天链路按此命中匹配) + 正文
CREATE TABLE IF NOT EXISTS "WorkSetting" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSetting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkSetting_workId_sort_idx" ON "WorkSetting"("workId", "sort");

-- 外键:随作品级联删除
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkSetting_workId_fkey') THEN
        ALTER TABLE "WorkSetting" ADD CONSTRAINT "WorkSetting_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 文档归属作品(可空:不归属时行为与旧版一致;作品删除时置空,文档保留不丢失)
ALTER TABLE "WriteDoc" ADD COLUMN IF NOT EXISTS "workId" TEXT;

CREATE INDEX IF NOT EXISTS "WriteDoc_workId_updatedAt_idx" ON "WriteDoc"("workId", "updatedAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WriteDoc_workId_fkey') THEN
        ALTER TABLE "WriteDoc" ADD CONSTRAINT "WriteDoc_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
