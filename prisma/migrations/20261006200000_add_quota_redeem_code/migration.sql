-- 激活码表：管理员批量生成,用户兑换后到账「附加余额」(跨天存续,基础日限烧完后
-- 自动扣余额,用完为止)。余额只由 QuotaLedger 的 redeem/bonus_spend 流水推导,本表
-- 只存发码凭证,删码不影响已到账额度。
CREATE TABLE IF NOT EXISTS "QuotaRedeemCode" (
    "code" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "redeemedBy" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuotaRedeemCode_pkey" PRIMARY KEY ("code")
);
