-- 通用档案（波1）：User.nickname 加列 + UserDomainProfile 表（本波只写 domain='general'）。
-- nickname 可空：称呼回退链 nickname → name → 不出现称呼，不回退邮箱前缀。
-- IF NOT EXISTS / DO $$ 守卫：本地已手动执行或 db push 过的场景下 migrate deploy 可安全重放。
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nickname" TEXT;

CREATE TABLE IF NOT EXISTS "UserDomainProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserDomainProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserDomainProfile_userId_domain_key" ON "UserDomainProfile"("userId", "domain");

CREATE INDEX IF NOT EXISTS "UserDomainProfile_userId_idx" ON "UserDomainProfile"("userId");

DO $$ BEGIN
    ALTER TABLE "UserDomainProfile" ADD CONSTRAINT "UserDomainProfile_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
