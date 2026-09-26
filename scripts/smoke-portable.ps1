$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'dist\SSH Board Client 1.0.0.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "未找到打包产物: $exe" }
Get-Process -Name 'SSH Board Client' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $exe -ArgumentList '--remote-debugging-port=9222' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 15
if ($p.HasExited) { throw "portable进程已退出 code=" + $p.ExitCode }
try {
  & node (Join-Path $PSScriptRoot 'cdp-check.mjs')
} finally {
  Get-Process -Name 'SSH Board Client' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
