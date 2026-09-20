#requires -version 7
# 清掉 verify-brand.ps1 留下的测试痕迹（不动 stage / sfx 里的正式品牌文件）。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rebrand = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand'
$scratch = Join-Path $rebrand 'verify'
$testRoot = [System.IO.Path]::GetFullPath($rebrand) + [System.IO.Path]::DirectorySeparatorChar

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*Python312*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

foreach ($slug in @('VideoMix', 'SparkCut')) {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$slug"
    if (-not (Test-Path -LiteralPath $key)) { continue }
    $where = [string](Get-ItemProperty -LiteralPath $key).InstallLocation
    if ($where -and $where.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $key -Force
        Write-Output "删除测试卸载项 $slug（$where）"
    }
}
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($slug in @('VideoMix', 'SparkCut')) {
    $link = Join-Path $programs "$slug.lnk"
    if (-not (Test-Path -LiteralPath $link)) { continue }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($link).TargetPath
    if ($target -and $target.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $link -Force
        Write-Output "删除测试开始菜单快捷方式 $slug.lnk（$target）"
    }
}

if (Test-Path -LiteralPath $scratch) {
    $full = [System.IO.Path]::GetFullPath($scratch)
    if (-not $full.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝删除工作目录之外的路径：$full"
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    Write-Output "已删除测试目录 $full"
}

Write-Output '--- 残留进程 ---'
foreach ($name in @('videomix', 'VideoMix', 'python')) {
    Get-Process $name -ErrorAction SilentlyContinue | Select-Object Id, ProcessName
}
Write-Output '--- 交付目录 ---'
Get-ChildItem -LiteralPath 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-rebuild' -File |
    Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String | Write-Output
