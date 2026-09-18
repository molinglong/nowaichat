# Next.js 开发服务器完整重启脚本
# 注意:会误杀所有 node 进程,按端口精确定位请用 restart-dev-3456.ps1

# 停止所有 Node 进程
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 等待进程关闭
Start-Sleep -Seconds 1

# 保留 .next(webpack 持久化编译缓存):保留时重启后热编译 1-3s,
# 清空则每次启动全量冷编译 10-30s。缓存损坏 webpack 会自动重建。
# 若启动异常,先运行 clean-cache.bat 彻底清理后再启动。
Write-Host "Keeping .next cache for fast warm rebuild..." -ForegroundColor DarkGray

# 启动开发服务器
Write-Host "Starting development server..." -ForegroundColor Green
npm run dev
