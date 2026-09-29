$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'scripts\sftp-root'
$full = [System.IO.Path]::GetFullPath($target)
if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw "path out of range: $full" }
foreach ($name in @('newdir_x', 'dir_test', 'dirA', 'hello.txt')) {
  $p = Join-Path $full $name
  if (Test-Path -LiteralPath $p) { Remove-Item -Recurse -Force -LiteralPath $p }
}
Write-Output "cleaned: $full"
