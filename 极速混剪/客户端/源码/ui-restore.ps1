#requires -version 7
<#
  把客户端界面回退到某一个快照（快照用 ui-snapshot.ps1 生成）。

  用法（在仓库根目录）：
      pwsh -File work\rebrand\ui-restore.ps1 -List
      pwsh -File work\rebrand\ui-restore.ps1 -Version 20260918-101500-改造前
      pwsh -File work\rebrand\ui-restore.ps1 -Latest -Rebuild

  不带 -Rebuild 时只把界面包放回 stage（下次跑 rebrand.py 出的就是这个界面）；
  带 -Rebuild 时立刻重跑一遍出包流程，直接产出安装包。
#>
param(
    [string]$Version,
    [switch]$Latest,
    [switch]$List,
    [switch]$Rebuild,
    [string]$Root = 'E:\GPT Codex\2026-09-15\new-chat'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rebrand  = Join-Path $Root 'work\rebrand'
$versions = Join-Path $rebrand 'ui-versions'
$stage    = Join-Path $Root 'work\videomix-rebuild\stage'
$py       = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'

if (-not (Test-Path -LiteralPath $versions)) { throw "还没有任何快照：$versions" }

$all = Get-ChildItem -LiteralPath $versions -Directory | Sort-Object Name
if ($List -or (-not $Version -and -not $Latest)) {
    Write-Output '可用快照（新→旧）：'
    foreach ($d in ($all | Sort-Object Name -Descending)) {
        $asar = Join-Path $d.FullName 'app.asar'
        $len = if (Test-Path -LiteralPath $asar) { (Get-Item -LiteralPath $asar).Length } else { 0 }
        Write-Output ('    {0}    {1} 字节' -f $d.Name, $len)
    }
    if (-not $List) {
        Write-Output ''
        Write-Output '用法：pwsh -File work\rebrand\ui-restore.ps1 -Version <快照名> [-Rebuild]'
    }
    return
}

if ($Latest) {
    if (-not $all) { throw '没有任何快照' }
    $dir = ($all | Sort-Object Name)[-1]
} else {
    $dir = $all | Where-Object { $_.Name -eq $Version } | Select-Object -First 1
    if (-not $dir) {
        # 允许只写一部分名字
        $dir = $all | Where-Object { $_.Name -like "*$Version*" } | Select-Object -First 1
    }
    if (-not $dir) { throw "找不到快照：$Version（用 -List 看有哪些）" }
}

Write-Output "回退到：$($dir.Name)"
$stageAsar = Join-Path $stage 'videomix\resources\app.asar'
Copy-Item -LiteralPath (Join-Path $dir.FullName 'app.asar') `
    -Destination $stageAsar -Force
if (Test-Path -LiteralPath (Join-Path $dir.FullName 'VideoMix.exe')) {
    Copy-Item -LiteralPath (Join-Path $dir.FullName 'VideoMix.exe') `
        -Destination (Join-Path $stage 'VideoMix.exe') -Force
}
if (Test-Path -LiteralPath (Join-Path $dir.FullName 'brand.json')) {
    Copy-Item -LiteralPath (Join-Path $dir.FullName 'brand.json') `
        -Destination (Join-Path $rebrand 'brand.json') -Force
}

# 主程序里写死了 app.asar 的头部哈希（SHA256），换了界面包必须同步改回来，
# 否则客户端启动时直接 "Integrity check failed for asar archive" 退出。
$bodyExe = Join-Path $stage 'videomix\videomix.exe'
if (Test-Path -LiteralPath $bodyExe) {
    & $py (Join-Path $rebrand 'patch_integrity.py') $bodyExe $stageAsar
    if ($LASTEXITCODE -ne 0) { throw "同步完整性哈希失败，退出码 $LASTEXITCODE" }
}

$hash = (Get-FileHash -Algorithm SHA256 $stageAsar).Hash
Write-Output "已回退，stage 里的 app.asar SHA256 = $hash"

if ($Rebuild) {
    Write-Output '重新出包中……'
    & $py (Join-Path $rebrand 'rebrand.py')
    if ($LASTEXITCODE -ne 0) { throw "出包失败，退出码 $LASTEXITCODE" }
    Write-Output '出包完成'
} else {
    Write-Output '下一步要出安装包就运行：'
    Write-Output "    $py work\rebrand\rebrand.py"
}
