#requires -version 7
<#
  给「客户端界面」拍一个可回退的快照。

  一次快照 = 一个文件夹，里面有：
      app.asar       当前的界面包（改界面就是改它）
      VideoMix.exe   配套的启动器
      brand.json     当时的品牌/版本配置
      说明.txt       时间、大小、SHA256、当时的说明

  用法（在仓库根目录）：
      pwsh -File work\rebrand\ui-snapshot.ps1 -Name 改造前
#>
param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat'
)
$ErrorActionPreference = 'Stop'

$rebrand = Join-Path $Root 'work\rebrand'
$stage   = Join-Path $Root 'work\videomix-rebuild\stage'
$versions = Join-Path $rebrand 'ui-versions'

$admin = Join-Path $stage 'videomix\resources\app.asar'
$launcher = Join-Path $stage 'VideoMix.exe'
$brand = Join-Path $rebrand 'brand.json'

foreach ($p in @($admin, $launcher, $brand)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "缺少文件：$p" }
}

$slug = ($Name -replace '[\\/:*?"<>|\s]+', '-').Trim('-')
if (-not $slug) { $slug = 'snapshot' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dir = Join-Path $versions "$stamp-$slug"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Copy-Item -LiteralPath $admin    -Destination (Join-Path $dir 'app.asar')    -Force
Copy-Item -LiteralPath $launcher -Destination (Join-Path $dir 'VideoMix.exe') -Force
Copy-Item -LiteralPath $brand    -Destination (Join-Path $dir 'brand.json')  -Force

$hash = (Get-FileHash -Algorithm SHA256 (Join-Path $dir 'app.asar')).Hash
$size = (Get-Item -LiteralPath (Join-Path $dir 'app.asar')).Length
$cfg = Get-Content -LiteralPath $brand -Raw | ConvertFrom-Json

@(
    "名称：$Name"
    "时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    "app.asar：$size 字节"
    "SHA256：$hash"
    "版本号：$($cfg.version)    安装包名：$($cfg.setupName)"
    ""
    "回退到这一版："
    "    pwsh -File work\rebrand\ui-restore.ps1 -Version '$stamp-$slug'"
    "回退到这一版并重新出安装包："
    "    pwsh -File work\rebrand\ui-restore.ps1 -Version '$stamp-$slug' -Rebuild"
) | Set-Content -LiteralPath (Join-Path $dir '说明.txt') -Encoding utf8

Write-Output "快照已保存："
Write-Output "    $dir"
Write-Output "    app.asar $size 字节  SHA256 $hash"
