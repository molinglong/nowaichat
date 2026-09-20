# 一次性诊断部署:手动切换新产物,不自动回滚,抓取验证失败现场(用完即删)
$ErrorActionPreference = "Stop"
$script = @'
PKG=/tmp/aichatt-dist.tar.gz
NEW=/opt/aichatt-dist.new
OLD=/opt/aichatt-dist.old
rm -rf $NEW
mkdir -p $NEW
echo "[1] extracting..."
tar -xzf $PKG -C $NEW && echo "extract OK" || echo "extract FAIL"
rm -f $PKG
echo "[2] switching..."
rm -rf $OLD
mv /opt/aichatt-dist $OLD
mv $NEW /opt/aichatt-dist
echo "[3] restarting container..."
docker restart aichatt-app
sleep 10
echo "[4] container status:"
docker ps --format '{{.Names}} {{.Status}}' | grep aichatt
echo "[5] curl /login:"
curl -s -o /tmp/login-check.html -w 'HTTP:%{http_code} time:%{time_total}s size:%{size_download}\n' http://127.0.0.1:3001/login
echo "[6] html head 300B:"
head -c 300 /tmp/login-check.html
echo ""
echo "[7] grep title count:"
grep -c "aichatt" /tmp/login-check.html || echo NO_MATCH
echo "[8] logs tail:"
docker logs aichatt-app --tail 15 2>&1 | tail -15
'@
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($script -replace "`r`n", "`n")))
& C:\Windows\System32\OpenSSH\ssh.exe -o BatchMode=yes root@yuban.icu "echo $b64 | base64 -d | bash 2>&1"
