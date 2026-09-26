$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$p = Start-Process -FilePath $electron -ArgumentList '.', '--remote-debugging-port=9222' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
try {
  & node (Join-Path $PSScriptRoot 'cdp-check.mjs')
  & node (Join-Path $PSScriptRoot 'cdp-connect-fail.mjs')
} finally {
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
