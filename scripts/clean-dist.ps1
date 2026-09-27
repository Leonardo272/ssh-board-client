$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
foreach ($name in @('dist-build', 'dist-new')) {
  $target = Join-Path $root $name
  $full = [System.IO.Path]::GetFullPath($target)
  if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw "path out of range: $full" }
  if (Test-Path -LiteralPath $full) {
    Remove-Item -Recurse -Force -LiteralPath $full
    Write-Output "removed $full"
  } else {
    Write-Output "not exists: $full"
  }
}
