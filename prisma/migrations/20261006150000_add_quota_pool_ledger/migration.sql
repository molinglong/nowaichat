-- 公共额度：QuotaPool（全局单行池 + 个人日限配置）+ QuotaLedger（计费流水）。
-- 仅新增两张表，不动任何现有表；种子行用 ON CONFLICT 保证重放安全。
-- 参数默认值：池 20M、日补 2M、正式个人日限 200K/天、临时访客 60K/天。
CREATE TABLE IF NOT EXISTS "QuotaPool" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "totalTokens" INTEGER NOT NULL,
    "usedTokens" INTEGER NOT NULL DEFAULT 0,
    "dailyRefillTokens" INTEGER NOT NULL DEFAULT 0,
    "dayKey" TEXT NOT NULL,
    "perUserDailyTokens" INTEGER NOT NULL,
    "ephemeralPerUserDailyTokens" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotaPool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QuotaLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuotaLedger_userId_dayKey_idx" ON "QuotaLedger"("userId", "dayKey");

INSERT INTO "QuotaPool" ("id", "totalTokens", "usedTokens", "dailyRefillTokens", "dayKey", "perUserDailyTokens", "ephemeralPerUserDailyTokens", "updatedAt")
VALUES ('global', 20000000, 0, 2000000, '2026-10-06', 200000, 60000, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
