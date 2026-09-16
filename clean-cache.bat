@echo off
chcp 65001 >nul 2>&1
title AI Chat 缓存清理
cd /d "%~dp0"

echo ========================================
echo     AI Chat 停止服务并清理缓存
echo ========================================
echo.

:: [1/3] 停止占用 3000 端口的开发服务器
echo [1/3] 正在停止开发服务器...
set "FOUND="
for /f %%a in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess"') do (
    set "FOUND=%%a"
    taskkill /f /pid %%a >nul 2>nul
    echo       已停止进程 PID: %%a
)
if not defined FOUND (
    echo       未检测到运行中的开发服务器（端口 3000）。
)

:: 等待端口与文件句柄释放
timeout /t 1 /nobreak >nul

:: [2/3] 清理 .next 缓存目录
echo [2/3] 正在清理 .next 缓存目录...
if exist ".next" (
    rmdir /s /q ".next"
    if exist ".next" (
        echo       [警告] 缓存清理失败，请确认没有程序占用该目录。
    ) else (
        echo       缓存已清理。
    )
) else (
    echo       缓存目录不存在，无需清理。
)

:: [3/3] 完成
echo [3/3] 清理完成。
echo.
echo ========================================
echo  如需重新启动服务，请双击 start.bat
echo ========================================
echo.
pause
