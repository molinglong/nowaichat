@echo off
chcp 65001 >nul
echo ========================================
echo        AI Chat 完全重置工具
echo ========================================
echo.
echo 警告：此操作将：
echo   1. 删除 .next 缓存目录
echo   2. 删除 dist 输出目录  
echo   3. 重置数据库
echo.
set /p confirm="确定要继续？(y/n) "
if /i not "%confirm%"=="y" (
    echo 已取消
    pause
    exit /b 0
)

echo.
echo [1/4] 停止所有 Node 进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
timeout /t 2 /nobreak >nul

echo [2/4] 删除 .next 缓存...
powershell -Command "Remove-Item -Path '.next','dist' -Recurse -Force -ErrorAction SilentlyContinue"
echo ✅ OK

echo [3/4] 重新生成 Prisma Client...
call npx prisma generate >nul 2>nul
echo ✅ OK

echo [4/4] 清理浏览器缓存提示...
echo ℹ️  建议同时按下 Ctrl+Shift+Del 清理浏览器缓存
echo.
echo ========================================
echo 完全重置完成！可以重新启动项目。
echo ========================================
pause
