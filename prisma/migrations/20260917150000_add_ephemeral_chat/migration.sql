-- 临时聊天(访客模式):
-- User 新增访客密码 hash 与 临时模式记忆注入开关;
-- Conversation 新增临时标记(隔离区)。

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "guestPasswordHash" TEXT;
ALTER TABLE "User" ADD COLUMN     "ephemeralMemoryInjection" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "isEphemeral" BOOLEAN NOT NULL DEFAULT false;
