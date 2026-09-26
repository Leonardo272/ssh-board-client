$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$log = Join-Path $root 'smoke-run.log'

$p = Start-Process -FilePath $electron -ArgumentList '.', '--remote-debugging-port=9222', "--enable-logging=$log" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
if ($p.HasExited) {
  Write-Output ("EXITED code=" + $p.ExitCode)
  if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 30 }
  exit 1
}
Write-Output ("RUNNING pid=" + $p.Id)
try {
  $pages = Invoke-RestMethod -Uri 'http://127.0.0.1:9222/json' -TimeoutSec 5
  foreach ($pg in $pages) { Write-Output ("PAGE: " + $pg.title + " | " + $pg.url) }
} catch {
  Write-Output ("CDP不可用: " + $_.Exception.Message)
}
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output "SMOKE DONE"
