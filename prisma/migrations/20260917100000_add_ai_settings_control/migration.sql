-- AI 设置控制总开关：关闭时 chat route 不注入 update_settings 工具（物理级关闭）
-- 刻意不在 AI 可控注册表内，仅能通过 设置→通用 手动修改
ALTER TABLE "User" ADD COLUMN "aiSettingsControl" BOOLEAN NOT NULL DEFAULT true;
