#requires -version 7
# 删掉截图脚本留下的临时安装目录（约 3 GB），只动 work\rebrand 下面自己的目录。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rebrand = [System.IO.Path]::GetFullPath('E:\GPT Codex\2026-09-15\new-chat\work\rebrand')
$guard = $rebrand + [System.IO.Path]::DirectorySeparatorChar
foreach ($name in @('shots', 'verify', 'updatetest', 'upde2e')) {
    $target = Join-Path $rebrand $name
    if (-not (Test-Path -LiteralPath $target)) { Write-Output "跳过（不存在）：$target"; continue }
    $full = [System.IO.Path]::GetFullPath($target)
    if (-not $full.StartsWith($guard, [StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝删除工作目录之外的路径：$full"
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    Write-Output "已删除 $full"
}
Get-ChildItem -LiteralPath $rebrand -Directory | Select-Object Name
