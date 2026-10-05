-- ClientDiagEvent: 浏览器端错误取证表。
-- 生产包 React #185 只有 minified 帧,光存堆栈定不了元凶,所以整包遥测(渲染计数器+面包屑)
-- 一起落库,手机端开 /diagnostics 直接读。无外键:临时模式/未登录态崩溃也要能写,且不留级联负担。
-- IF NOT EXISTS 守卫:本地已手动执行或 db push 过的场景下 migrate deploy 可安全跳过。
CREATE TABLE IF NOT EXISTS "ClientDiagEvent" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "page" TEXT,
    "userAgent" TEXT,
    "userIds" JSONB NOT NULL DEFAULT '[]',
    "context" JSONB NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientDiagEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientDiagEvent_hash_key" ON "ClientDiagEvent"("hash");

CREATE INDEX IF NOT EXISTS "ClientDiagEvent_lastAt_idx" ON "ClientDiagEvent"("lastAt");
