# Next.js 开发服务器完整重启脚本
Write-Host "Cleaning .next and .cache directories..." -ForegroundColor Yellow

# 停止所有 Node 进程
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 等待进程关闭
Start-Sleep -Seconds 1

# 清理缓存
Remove-Item -Path "$PSScriptRoot\.next" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$PSScriptRoot\.cache" -Recurse -Force -ErrorAction SilentlyContinue

# 启动开发服务器
Write-Host "Starting development server..." -ForegroundColor Green
npm run dev
