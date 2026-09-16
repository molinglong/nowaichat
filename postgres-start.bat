@echo off
chcp 65001 >nul
title Aichatt - Postgres

echo ============================================================
echo   Aichatt Postgres 启动
echo ============================================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Docker，请先安装 Docker Desktop。
    echo         下载地址: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [错误] Docker 未运行，请启动 Docker Desktop。
    echo.
    pause
    exit /b 1
)

echo [1/3] 启动 Postgres 容器...
docker compose up -d
if errorlevel 1 (
    echo [错误] docker compose 启动失败。
    pause
    exit /b 1
)

echo.
echo [2/3] 等待 Postgres 就绪...
:wait_loop
docker exec aichatt-postgres pg_isready -U admin >nul 2>&1
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto wait_loop
)
echo       Postgres 就绪

echo.
echo [3/3] 验证连接...
docker exec aichatt-postgres psql -U admin -d aichatt -c "SELECT version();" 2>nul | findstr /C:"PostgreSQL" >nul
if errorlevel 1 (
    echo [警告] 无法执行 psql 查询，但 pg_isready 已通过。
) else (
    echo       连接成功
)

echo.
echo ============================================================
echo   Postgres 已启动
echo   端口: localhost:5432
echo   用户: admin
echo   数据库: aichatt
echo.
echo   下一步: npm run dev
echo ============================================================
echo.
pause