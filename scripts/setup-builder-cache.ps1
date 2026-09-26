$ErrorActionPreference = 'Stop'
# 将手动下载的electron zip放入@electron/get缓存，避免打包时重复下载
$url = 'https://npmmirror.com/mirrors/electron/33.4.11/electron-v33.4.11-win32-x64.zip'
$tmp = [System.IO.Path]::GetTempPath()
$zip = Join-Path $tmp 'electron-33.4.11-win32-x64.zip'
if (-not (Test-Path -LiteralPath $zip)) { throw "未找到 $zip" }
$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($url)) | ForEach-Object { $_.ToString('x2') })
$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron\Cache'
$dir = Join-Path $cacheRoot $hash
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$dest = Join-Path $dir 'electron-v33.4.11-win32-x64.zip'
Copy-Item -LiteralPath $zip -Destination $dest -Force
Write-Output ("缓存就位: " + $dest)
