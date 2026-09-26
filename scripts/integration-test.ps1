$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$srv = Start-Process -FilePath python -ArgumentList (Join-Path $PSScriptRoot 'test-ssh-server.py') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'test-server.log')
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$app = Start-Process -FilePath $electron -ArgumentList '.', '--remote-debugging-port=9222' -WorkingDirectory $root -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 6
  & node (Join-Path $PSScriptRoot 'cdp-integration.mjs')
  $code = $LASTEXITCODE
} finally {
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
  if (-not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
  Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
exit $code
