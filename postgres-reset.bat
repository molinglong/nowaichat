@echo off
chcp 65001 >nul
title Aichatt - Postgres 重置

echo ============================================================
echo   警告：将删除 Postgres 中的所有数据！
echo ============================================================
echo.
echo  本脚本会:
echo   1. 备份当前 dev.db (如果有)
echo   2. 停止并删除 Postgres volume (数据不可恢复)
echo   3. 重新创建空的 Postgres
echo.
echo  Type 'yes' to continue:
set /p confirm="> "
if /i not "%confirm%"=="yes" (
    echo 已取消。
    pause
    exit /b 0
)

if exist dev.db (
    for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value 2^>nul') do set "dt=%%a"
    set "stamp=%dt:~0,8%-%dt:~8,6%"
    copy /Y dev.db "dev.db.before-reset-%stamp%" >nul
    echo [OK] dev.db 已备份到 dev.db.before-reset-%stamp%
) else (
    echo [INFO] dev.db 不存在，跳过备份。
)

echo.
echo [1/3] 删除 Postgres volume...
docker compose down -v
if errorlevel 1 (
    echo [错误] 删除失败。
    pause
    exit /b 1
)

echo.
echo [2/3] 重新创建 Postgres...
docker compose up -d

echo.
echo [3/3] 等待就绪...
:wait_loop
docker exec aichatt-postgres pg_isready -U admin >nul 2>&1
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto wait_loop
)
echo       Postgres 就绪

echo.
echo ============================================================
echo   重置完成
echo   接下来:
echo     1. npx prisma migrate deploy
echo     2. node scripts/migrate-sqlite-to-postgres.cjs
echo ============================================================
echo.
pause