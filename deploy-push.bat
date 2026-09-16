@echo off
REM ============================================================
REM  Windows 上把代码同步到 VPS 的小工具
REM  用法: deploy-push.bat user@your-vps-ip
REM ============================================================

setlocal

if "%~1"=="" (
    echo 用法: %~nx0 user@vps-ip [目标目录]
    echo 示例: %~nx0 root@1.2.3.4 /root/aichatt
    exit /b 1
)

set "VPS=%~1"
set "REMOTE_DIR=%~2"
if "%REMOTE_DIR%"=="" set "REMOTE_DIR=/root/aichatt"

echo.
echo ============================================================
echo   同步 aichatt 到 %VPS%:%REMOTE_DIR%
echo ============================================================
echo.

REM 用 rsync (如果有) 没有则用 scp
where rsync >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo 使用 rsync ...
    rsync -avz --delete ^
        --exclude 'node_modules' ^
        --exclude '.next' ^
        --exclude '.git' ^
        --exclude 'src/generated' ^
        --exclude 'uploads' ^
        --exclude '*.db' ^
        --exclude '*.db-*' ^
        --exclude '.env' ^
        --exclude '.env.local' ^
        --exclude 'deploy/backups' ^
        ./ "%VPS%:%REMOTE_DIR%/"
) else (
    echo 使用 scp (请确保已安装 OpenSSH) ...
    powershell -Command "Compress-Archive -Path '.', '..\Dockerfile' -DestinationPath '%TEMP%\aichatt-deploy.zip' -Force"
    scp "%TEMP%\aichatt-deploy.zip" "%VPS%:%REMOTE_DIR%-deploy.zip"
    echo 已上传,登录 VPS 后:
    echo   cd %REMOTE_DIR% && unzip -o ../aichatt-deploy.zip
)

echo.
echo 同步完成。下一步登录 VPS:
echo   ssh %VPS%
echo   cd %REMOTE_DIR%/deploy
echo   sudo ./deploy.sh update
echo.
