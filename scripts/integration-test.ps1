$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# 清理残留的调试端口占用（避免CDP连到僵尸实例）
$conns = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}
$srv = Start-Process -FilePath python -ArgumentList (Join-Path $PSScriptRoot 'test-ssh-server.py') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'test-server.log')
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$env:SBC_TEST_USER_DATA = Join-Path $env:TEMP ('sbc-test-userdata-' + (Get-Random))
$app = $null
foreach ($attempt in 1..3) {
  $app = Start-Process -FilePath $electron -ArgumentList '.', '--remote-debugging-port=9222' -WorkingDirectory $root -PassThru -WindowStyle Hidden
  $ok = $false
  foreach ($i in 1..15) {
    Start-Sleep -Milliseconds 800
    if ($app.HasExited) { break }
    if (Test-NetConnection 127.0.0.1 -Port 9222 -InformationLevel Quiet -WarningAction SilentlyContinue) { $ok = $true; break }
  }
  if ($ok) { break }
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 5
}
try {
  if ($app.HasExited) { throw "electron启动失败（已重试3次）" }
  & node (Join-Path $PSScriptRoot 'cdp-integration.mjs')
  $code = $LASTEXITCODE
} finally {
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
  if (-not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
  Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
exit $code
