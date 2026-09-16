-- Add stylePreset to Conversation table
-- 新版风格预设，值为 preset id（balanced/practical/dev/editor/mentor/scholar），
-- NULL 时由应用层回退到 balanced。旧字段 styleOffset 保留用于向后兼容。

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "stylePreset" TEXT;