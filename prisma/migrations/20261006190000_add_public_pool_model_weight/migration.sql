-- 公共池门面模型加计费倍率：结算落账 tokens × weight（1 = 与「标准」flash 同口径），
-- 管理员在设置→公共额度的模型卡里按各上游真实成本填；ledger 记倍率后的数，
-- 池扣减/个人日限/me 口全部吃同一条流水，口径自动一致。
ALTER TABLE "PublicPoolModel" ADD COLUMN "weight" DOUBLE PRECISION NOT NULL DEFAULT 1;
