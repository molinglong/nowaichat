-- 注册码表：注册改邀请制，必须持管理员生成的注册码才能建号（一码一用，防脚本批量注册烧池）
CREATE TABLE "RegisterCode" (
    "code" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "usedBy" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisterCode_pkey" PRIMARY KEY ("code")
);
