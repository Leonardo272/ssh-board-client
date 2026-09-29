$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$srv = Start-Process -FilePath python -ArgumentList (Join-Path $PSScriptRoot 'test-ssh-server.py') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'srv.log') -RedirectStandardError (Join-Path $root 'srv-err.log')
Start-Sleep -Seconds 3
try { & node (Join-Path $PSScriptRoot 'debug-flow.cjs') } finally {
  if (-not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
}
Get-Content (Join-Path $root 'srv-err.log') -ErrorAction SilentlyContinue | Select-Object -First 12
