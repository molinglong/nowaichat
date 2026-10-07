-- 公共池管理化：门面模型表（管理员增删，原静态「标准」迁入）+ 服务端 Key 表（按 provider 一把）。
-- 种子行把「标准」迁入 DB，ON CONFLICT 重放安全。
CREATE TABLE IF NOT EXISTS "PublicPoolModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "upstreamId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicPoolModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PublicPoolKey" (
    "provider" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicPoolKey_pkey" PRIMARY KEY ("provider")
);

INSERT INTO "PublicPoolModel" ("id", "name", "provider", "upstreamId", "enabled", "updatedAt")
VALUES ('deepseek-standard', '标准', 'deepseek', 'deepseek-flash', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
