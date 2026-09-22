-- AI 本地文件能力总开关：仅桌面客户端(Tauri)可执行，关闭时 chat route 不注入 local_file 工具
-- 默认 false —— 高危能力(写盘/删除)，需用户在 设置→本地文件 显式开启并选定工作区沙箱目录
ALTER TABLE "User" ADD COLUMN "localFilesEnabled" BOOLEAN NOT NULL DEFAULT false;
