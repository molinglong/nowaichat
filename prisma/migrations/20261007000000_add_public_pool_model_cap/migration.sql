-- 公共池门面模型加全站累计预算 capTokens：0=不限；Σchat 落账(×倍率后)达到即停运+用户端隐藏
ALTER TABLE "PublicPoolModel" ADD COLUMN "capTokens" INTEGER NOT NULL DEFAULT 0;
