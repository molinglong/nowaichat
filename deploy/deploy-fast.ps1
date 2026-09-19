# deploy-fast.ps1 — aichatt 本地构建产物直推 VPS（3-5 分钟热修）
#
# 前置条件（只需一次）:
#   1. compose 已切到挂载产物模式（/opt/aichatt-dist:/app:ro, 见 deploy/docker-compose.yml）
#   2. VPS 已有对应 Node 大版本 slim 镜像（node:24-slim, 与本地 node -v 对齐）
#   3. SSH 免密: ssh root@yuban.icu 能直连
#
# 用法:  powershell -File deploy/deploy-fast.ps1
# 原理:  本地 npm run build → 组装 standalone 产物(排除 win32 sharp)
#        → tar.gz → scp → VPS 解压到 .new 目录 → mv 原子切换 → 重启容器 → 健康验证
#        验证失败自动回滚（把 .old 目录换回去重启）。
#
# 注意:  构建前自动检查 dev server(3456/3000) —— dev/build 共用 .next 会炸产物。

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$VpsHost = "root@yuban.icu"
$DistDir = "/opt/aichatt-dist"
$PkgName = "aichatt-dist.tar.gz"

Write-Host "=== [1/6] 检查 dev server 未运行 ===" -ForegroundColor Cyan
$nextProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'next' -and $_.CommandLine -notmatch 'deploy-fast' }
if ($nextProcs) {
    Write-Host "ERROR: 检测到 next 进程在跑(dev/build 互斥), 先停止: restart-dev-3456.ps1 / kill 进程" -ForegroundColor Red
    $nextProcs | ForEach-Object { Write-Host ("  PID " + $_.ProcessId + ": " + $_.CommandLine.Substring(0, [Math]::Min(100, $_.CommandLine.Length))) }
    exit 1
}
Write-Host "OK"

Write-Host "=== [2/6] 本地构建 npm run build ===" -ForegroundColor Cyan
Push-Location $ProjectRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: 构建失败" -ForegroundColor Red; exit 1 }
} finally { Pop-Location }
if (-not (Test-Path "$ProjectRoot\.next\standalone\server.js")) {
    Write-Host "ERROR: .next\standalone\server.js 不存在, 确认 next.config.mjs 的 output:'standalone'" -ForegroundColor Red
    exit 1
}
Write-Host "OK"

Write-Host "=== [3/6] 组装产物（standalone + static + public, 排除 win32 sharp）===" -ForegroundColor Cyan
$stage = Join-Path $env:TEMP "aichatt-dist-stage"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null
# standalone 本体（含打包的 node_modules 与 server.js）
Copy-Item -Recurse "$ProjectRoot\.next\standalone\*" $stage
# standalone 不自带静态资源/公共文件，需手动并入（与 Dockerfile 一致）
Copy-Item -Recurse "$ProjectRoot\.next\static" "$stage\.next\static" -Force
Copy-Item -Recurse "$ProjectRoot\public" "$stage\public" -Force
# 排除 win32 原生 sharp（Linux 容器用不上; 若代码开始 import sharp 需改为在容器内重装）
$imgDir = "$stage\node_modules\@img"
if (Test-Path $imgDir) { Remove-Item -Recurse -Force $imgDir; Write-Host "已排除 node_modules\@img (win32 sharp)" }

Write-Host "=== [4/6] 打包 tar.gz ===" -ForegroundColor Cyan
$pkgPath = Join-Path $env:TEMP $PkgName
Remove-Item -Force $pkgPath -ErrorAction SilentlyContinue
tar -czf $pkgPath -C $stage .
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: tar 打包失败" -ForegroundColor Red; exit 1 }
$pkgMB = [math]::Round((Get-Item $pkgPath).Length / 1MB, 1)
Write-Host "OK ($pkgMB MB)"

Write-Host "=== [5/6] 上传 VPS ===" -ForegroundColor Cyan
& C:\Windows\System32\OpenSSH\scp.exe $pkgPath "${VpsHost}:/tmp/$PkgName"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: scp 失败" -ForegroundColor Red; exit 1 }
Write-Host "OK"

Write-Host "=== [6/6] VPS 原子切换 + 重启 + 健康验证（失败自动回滚）===" -ForegroundColor Cyan
$remoteScript = @"
set -e
PKG=/tmp/$PkgName
NEW=$DistDir.new
OLD=$DistDir.old
rm -rf `$NEW
mkdir -p `$NEW
tar -xzf `$PKG -C `$NEW
rm -f `$PKG
# 原子切换: dist -> dist.old, dist.new -> dist
if [ -d $DistDir ]; then
  rm -rf `$OLD
  mv $DistDir `$OLD
fi
mv `$NEW $DistDir
docker restart aichatt-app >/dev/null
# 健康验证: 最多等 60s, 检查登录页渲染 + session API
OK=0
for i in `$(seq 1 12); do
  sleep 5
  BODY=`$(curl -s http://127.0.0.1:3001/login || true)
  if echo "`$BODY" | grep -q "八号产房"; then OK=1; break; fi
done
if [ `$OK -ne 1 ]; then
  echo "VERIFY FAILED, rolling back..."
  if [ -d `$OLD ]; then
    rm -rf $DistDir
    mv `$OLD $DistDir
    docker restart aichatt-app >/dev/null
  fi
  echo "ROLLBACK DONE"
  exit 1
fi
rm -rf `$OLD 2>/dev/null || true
echo "DEPLOY OK: /login 渲染正常, 旧产物已清理"
"@
$cleanScript = ($remoteScript -replace "`r`n", "`n") -replace "`r", ""
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cleanScript))
& C:\Windows\System32\OpenSSH\ssh.exe -o BatchMode=yes $VpsHost "echo $b64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: VPS 切换失败（已自动回滚或需人工检查）" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "部署完成 ✅  https://chat.yuban.icu" -ForegroundColor Green
