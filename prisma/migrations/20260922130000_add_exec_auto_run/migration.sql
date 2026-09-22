-- 本地文件 exec 命令"始终运行"开关:开启后 AI 执行 PowerShell 命令免确认直接执行
-- (含写入/删除/联网命令,高危);默认 false=只读白名单自动、其余弹确认卡
ALTER TABLE "User" ADD COLUMN "localFilesExecAutoRun" BOOLEAN NOT NULL DEFAULT false;
