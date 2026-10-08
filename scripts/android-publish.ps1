# android-publish.ps1 —— APK 装箱 + 发布清单生成 + (-Upload 显式开关时)推 VPS。
# 默认只做本地装箱(仓库 dist\android\),绝不碰生产;
# 上传必须显式 -Upload,并要求 nginx 已配好 location /apk/ → /opt/aichatt-apk/。
param(
    [switch]$Upload,
    [switch]$SkipBuild,
    [string]$Notes = ''
)
$ErrorActionPreference = 'Stop'
$repo   = Split-Path -Parent $PSScriptRoot
$mirror = 'D:\aichatt-android'
$ssh    = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp    = 'C:\Windows\System32\OpenSSH\scp.exe'
$remoteDir = '/opt/aichatt-apk'
$apkBase   = 'https://chat.yuban.icu/apk'

# 1. 构建(盖新版本号章);-SkipBuild 复用上次产物
if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'android-build.ps1')
    if ($LASTEXITCODE -ne 0) { throw "android-build failed with code $LASTEXITCODE" }
}

# 2. 找最新 APK + 读构建脚本盖的版本章
$apk = Get-ChildItem -Path (Join-Path $mirror 'src-tauri\gen\android\app') -Recurse -Filter '*-debug.apk' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw 'mirror 里没有产物 APK' }
$conf = Get-Content (Join-Path $mirror 'src-tauri\tauri.android.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $conf.version
if (-not $version) { throw '镜像 tauri.android.conf.json 缺 version 章(构建脚本未跑?)' }

# 3. 本地装箱 dist\android\
$dist = Join-Path $repo 'dist\android'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$apkName = "aichatt-$version.apk"
$apkOut = Join-Path $dist $apkName
Copy-Item $apk.FullName $apkOut -Force

# 4. latest.json(UTF-8 无 BOM;Rust 侧已容忍 BOM,但源头就别造)
$manifest = [ordered]@{
    version = $version
    url     = "$apkBase/$apkName"
    notes   = $Notes
    size    = (Get-Item $apkOut).Length
}
$manifestPath = Join-Path $dist 'latest.json'
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "packed: $apkOut ($([math]::Round((Get-Item $apkOut).Length / 1MB, 1)) MB)"
Write-Output "manifest: $manifestPath"

# 5. 上传 —— 只在显式 -Upload 时执行
if ($Upload) {
    if (-not (Test-Path $ssh)) { throw "找不到 OpenSSH: $ssh" }
    & $ssh -o BatchMode=yes root@yuban.icu "mkdir -p $remoteDir"
    if ($LASTEXITCODE -ne 0) { throw "ssh mkdir failed" }
    & $scp -o BatchMode=yes $apkOut $manifestPath "root@yuban.icu:$remoteDir/"
    if ($LASTEXITCODE -ne 0) { throw "scp failed" }
    Write-Output "uploaded: $apkName + latest.json -> root@yuban.icu:$remoteDir/"
    Write-Output "线上校验: curl -s $apkBase/latest.json"
} else {
    Write-Output '未带 -Upload:仅本地装箱,未触碰 VPS。'
}
