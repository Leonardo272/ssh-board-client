$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$srv = Start-Process -FilePath python -ArgumentList (Join-Path $PSScriptRoot 'test-ssh-server.py') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'srv.log') -RedirectStandardError (Join-Path $root 'srv-err.log')
Start-Sleep -Seconds 3
$env:SBC_TEST_USER_DATA = "$env:TEMP\sbc-dbg-1"
$app = Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList '.', '--remote-debugging-port=9224' -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'app-out.log') -RedirectStandardError (Join-Path $root 'app-err.log')
Start-Sleep -Seconds 8
try { & node (Join-Path $PSScriptRoot 'debug-cdp.mjs') } finally {
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
  Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (-not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
}
Write-Output '--- app-err ---'
Get-Content (Join-Path $root 'app-err.log') -ErrorAction SilentlyContinue | Select-Object -First 12
Write-Output '--- app-out ---'
Get-Content (Join-Path $root 'app-out.log') -ErrorAction SilentlyContinue | Select-Object -First 12
