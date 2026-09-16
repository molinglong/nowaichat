@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  aichatt 一键启动脚本
REM  用途：检查 PostgreSQL 状态 → 启动 → 启动 Next.js
REM ============================================================

title aichatt 启动器

echo.
echo ============================================================
echo   aichatt 一键启动
echo ============================================================
echo.

REM ---------- 1. 检查 PostgreSQL 服务 ----------
echo [1/5] 检查 PostgreSQL 服务...

set "PG_SERVICE=postgresql-x64-18"
set "PG_DATA_DIR=D:\PostgreSQL\18\data"

REM 尝试用 sc 查询服务状态
sc query "%PG_SERVICE%" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    REM 服务存在，检查是否在运行
    for /f "tokens=*" %%s in ('sc query "%PG_SERVICE%" ^| findstr "STATE"') do set "PG_STATE=%%s"
    echo "%PG_STATE%" | findstr "RUNNING" >nul
    if %ERRORLEVEL% EQU 0 (
        echo        PostgreSQL 已在运行
    ) else (
        echo        PostgreSQL 未运行，正在启动...
        net start "%PG_SERVICE%" >nul 2>&1
        if %ERRORLEVEL% NEQ 0 (
            echo  启动失败，尝试用 pg_ctl 启动...
            "D:\PostgreSQL\18\bin\pg_ctl.exe" -D "%PG_DATA_DIR%" start
        )
        timeout /t 3 /nobreak >nul
    )
) else (
    echo        没找到 %PG_SERVICE% 服务，尝试用 pg_ctl 启动...
    "D:\PostgreSQL\18\bin\pg_ctl.exe" -D "%PG_DATA_DIR%" start
    if %ERRORLEVEL% NEQ 0 (
        echo  启动失败！请手动检查 PostgreSQL 是否已安装
        echo  预期安装路径: D:\PostgreSQL\18
        pause
        exit /b 1
    )
    timeout /t 3 /nobreak >nul
)

REM ---------- 2. 验证数据库连接 ----------
echo.
echo [2/5] 验证数据库连接...
set "PGPASSWORD=admin123"
"D:\PostgreSQL\18\bin\psql.exe" -U admin -h localhost -d aichatt -c "SELECT 1;" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  数据库连接失败！
    echo  请检查 .env 中的 DATABASE_URL 是否正确
    pause
    exit /b 1
)
echo        数据库连接正常

REM ---------- 3. 切换到项目目录 ----------
echo.
echo [3/5] 切换到项目目录...
cd /d "%~dp0"
if %ERRORLEVEL% NEQ 0 (
    echo  切换目录失败！
    pause
    exit /b 1
)

REM ---------- 4. 检查 3000 端口占用 ----------
echo.
echo [4/5] 检查 3000 端口...

REM 用 netstat 查找占用 3000 端口的 PID
set "PORT_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    set "PORT_PID=%%p"
)

if defined PORT_PID (
    echo        端口 3000 被进程 %PORT_PID% 占用

    REM 检查是不是 node.exe
    tasklist /FI "PID eq %PORT_PID%" /FO CSV /NH > "%TEMP%\tasklist_check.txt" 2>&1
    findstr /i "node.exe" "%TEMP%\tasklist_check.txt" >nul
    if %ERRORLEVEL% EQU 0 (
        echo        识别为 node 进程（可能是旧的 Next.js），准备杀掉...
        taskkill /F /PID %PORT_PID% > "%TEMP%\taskkill_result.txt" 2>&1
        if %ERRORLEVEL% EQU 0 (
            echo        已杀掉 PID %PORT_PID%
            timeout /t 2 /nobreak >nul
        ) else (
            echo        杀进程失败，请手动处理
            type "%TEMP%\taskkill_result.txt"
            pause
            exit /b 1
        )
    ) else (
        echo        但不是 node 进程，可能被其他程序占用！
        echo        请手动检查是哪个程序占用 3000 端口
        echo        提示: netstat -ano ^| findstr :3000
        pause
        exit /b 1
    )
) else (
    echo        端口 3000 空闲
)

REM ---------- 5. 启动 Next.js ----------
echo.
echo [5/5] 启动 Next.js(清缓存 + 8GB 堆)...
echo        访问地址: http://localhost:3000
echo        按 Ctrl+C 停止服务
echo.
echo --------------------------------------------------------
echo.

REM 清掉 .next / .cache,避免上次的脏构建引发 webpack OOM
if exist .next rmdir /s /q .next
if exist .cache rmdir /s /q .cache
if exist node_modules\.cache rmdir /s /q node_modules\.cache

REM V8 堆提到 8GB,避免 next dev + 大量模块编译时内存溢出
set NODE_OPTIONS=--max-old-space-size=8192

call npm run dev

REM 脚本结束前暂停，避免窗口一闪而过
echo.
echo --------------------------------------------------------
echo   Next.js 已停止
echo --------------------------------------------------------
pause
