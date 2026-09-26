$ErrorActionPreference = 'Stop'
$tmp = [System.IO.Path]::GetTempPath()
$zip = Join-Path $tmp 'electron-33.4.11-win32-x64.zip'
$un = Join-Path $tmp 'electron-unzip'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'node_modules\electron\dist'

if (-not (Test-Path -LiteralPath $zip)) { throw "未找到 $zip，请先下载 electron zip" }
if (Test-Path -LiteralPath $un) { Remove-Item -Recurse -Force -LiteralPath $un }
Expand-Archive -LiteralPath $zip -DestinationPath $un
$resolvedDist = [System.IO.Path]::GetFullPath($dist)
if (-not $resolvedDist.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw "路径越界: $resolvedDist" }
if (Test-Path -LiteralPath $dist) { Remove-Item -Recurse -Force -LiteralPath $dist }
Move-Item -LiteralPath $un -Destination $dist
Write-Output ("electron.exe: " + (Test-Path -LiteralPath (Join-Path $dist 'electron.exe')))
