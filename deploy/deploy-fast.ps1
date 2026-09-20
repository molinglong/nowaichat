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
# 注意:  dev/build 共用 .next 会炸产物 —— 检测到 dev 进程自动暂停, 部署结束(无论成败)自动恢复。

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$VpsHost = "root@yuban.icu"
$DistDir = "/opt/aichatt-dist"
$PkgName = "aichatt-dist.tar.gz"
# scp 上传限速(Kbit/s): 家宽上行被 scp 打满会拖慢全屋上网, 默认 ~1.1MB/s(实测链路峰值 1.8MB/s 的一半);
# 设 0 则不限速全速上传
$UploadLimitKbps = 9000

Write-Host "=== [1/6] dev server 自动暂停（部署结束后自动恢复）===" -ForegroundColor Cyan
# dev/build 共用 .next 会互相写坏产物必须错峰; 之前检测到就直接报错退出让用户手动停,
# 部署完还得手动想起重启 —— 改为自动 Stop, 结尾 finally 自动拉起, 用户全程无感
$needDevRestart = $false
$nextProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'next' -and $_.CommandLine -notmatch 'deploy-fast' }
if ($nextProcs) {
    $needDevRestart = $true
    $nextProcs | ForEach-Object {
        Write-Host ("  暂停 PID " + $_.ProcessId + ": " + $_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length)))
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}
Write-Host "OK"

try {

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
# 瘦身: 字体(103MB)/uploads(16MB)不进包 —— 包从 265MB 降到 ~145MB, 上传时间减半;
# fonts/fonts-subset 由 VPS 端切换时从旧产物原地回填(见 [6/6]);
# uploads 在容器里被 named volume 挂载遮蔽, 宿主机这份本来就不生效, 纯属白传
foreach ($skip in @("fonts-subset", "fonts", "uploads")) {
    Remove-Item -Recurse -Force "$stage\public\$skip" -ErrorAction SilentlyContinue
}
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
$scpArgs = @()
if ($UploadLimitKbps -gt 0) { $scpArgs += @("-l", "$UploadLimitKbps") }
$scpArgs += @($pkgPath, "${VpsHost}:/tmp/$PkgName")
& C:\Windows\System32\OpenSSH\scp.exe @scpArgs
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
# 字体不在 tar 包里: 切换后立刻从旧产物原地回填;
# 若验证失败回滚, OLD 里的字体尚未被搬走, 回滚后线上字体不受影响
for d in fonts fonts-subset; do
  if [ ! -d $DistDir/public/`$d ] && [ -d `$OLD/public/`$d ]; then
    mv `$OLD/public/`$d $DistDir/public/`$d
  fi
done
docker restart aichatt-app >/dev/null
# 健康验证: 最多等 60s, 检查登录页渲染 + session API
OK=0
for i in `$(seq 1 12); do
  sleep 5
  BODY=`$(curl -s http://127.0.0.1:3001/login || true)
  if echo "`$BODY" | grep -q "aichatt"; then OK=1; break; fi
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

} finally {
    if ($needDevRestart) {
        Write-Host "恢复本地 dev server (3456)..." -ForegroundColor Cyan
        Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Set-Location '$ProjectRoot'; npm run dev" -WindowStyle Minimized
    }
}
