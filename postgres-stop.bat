@echo off
chcp 65001 >nul
title Aichatt - Postgres 停止

echo ============================================================
echo   Aichatt Postgres 停止（数据保留）
echo ============================================================
echo.

docker compose down
if errorlevel 1 (
    echo [错误] docker compose down 失败。
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Postgres 已停止
echo   数据保留在 Docker volume aichatt_pgdata 中
echo   下次启动请双击 postgres-start.bat
echo ============================================================
echo.
pause