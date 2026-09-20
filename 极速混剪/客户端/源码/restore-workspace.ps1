#requires -version 7
# 把这次“换品牌”测试留下的东西清掉：
#   1) 停掉测试进程
#   2) 把 stage 里的文件还原成改品牌之前的原始版本（从 work\rebrand\base\payload.zip 里取）
#   3) 删掉测试装的目录、注册表卸载项、开始菜单快捷方式（只删指向测试目录的那些）
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$workspace = 'E:\GPT Codex\2026-09-15\new-chat'
$root = Join-Path $workspace 'work\videomix-rebuild'
$rebrand = Join-Path $workspace 'work\rebrand'
$stage = Join-Path $root 'stage'
$payload = Join-Path $rebrand 'base\payload.zip'
$scratch = Join-Path $rebrand 'verify'

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix', 'VideoMix-Setup-1.1.2')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*Python312*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

Write-Output '--- 还原 stage ---'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($payload)
try {
    $map = @{
        'videomix/resources/app.asar'   = 'videomix\resources\app.asar'
        'videomix/videomix.exe'         = 'videomix\videomix.exe'
        'videomix/uninstallerIcon.ico'  = 'videomix\uninstallerIcon.ico'
        '使用说明.txt'                   = '使用说明.txt'
        'VideoMix.exe'                  = 'VideoMix.exe'
    }
    foreach ($entry in $archive.Entries) {
        if (-not $map.ContainsKey($entry.FullName)) { continue }
        $target = Join-Path $stage $map[$entry.FullName]
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        Write-Output ("  还原 {0}（{1} 字节）" -f $target, (Get-Item -LiteralPath $target).Length)
    }
} finally {
    $archive.Dispose()
}

Write-Output ''
Write-Output '--- 清理注册表与快捷方式 ---'
$testRoot = [System.IO.Path]::GetFullPath($rebrand) + [System.IO.Path]::DirectorySeparatorChar
foreach ($slug in @('VideoMix', 'SparkCut')) {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$slug"
    if (-not (Test-Path -LiteralPath $key)) { continue }
    $info = Get-ItemProperty -LiteralPath $key
    $where = [string]$info.InstallLocation
    if ($where -and $where.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $key -Force
        Write-Output "  删除注册表卸载项 $slug（指向 $where）"
    } else {
        Write-Output "  保留注册表卸载项 $slug（指向 $where，不是这次测试装的）"
    }
}
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($slug in @('VideoMix', 'SparkCut')) {
    $link = Join-Path $programs "$slug.lnk"
    if (-not (Test-Path -LiteralPath $link)) { continue }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($link).TargetPath
    if ($target -and $target.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $link -Force
        Write-Output "  删除开始菜单快捷方式 $slug.lnk（指向 $target）"
    } else {
        Write-Output "  保留开始菜单快捷方式 $slug.lnk（指向 $target）"
    }
}

Write-Output ''
Write-Output '--- 删除测试安装目录 ---'
if (Test-Path -LiteralPath $scratch) {
    $full = [System.IO.Path]::GetFullPath($scratch)
    if (-not $full.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝删除工作目录之外的路径：$full"
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    Write-Output "  已删除 $full"
}

Write-Output ''
Write-Output '--- 交付目录状态（应该没被动过）---'
Get-ChildItem -LiteralPath (Join-Path $workspace 'outputs\videomix-rebuild') -File |
    Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String | Write-Output
Write-Output '--- sfx\Brand.cs 当前内容 ---'
Get-Content -LiteralPath (Join-Path $root 'sfx\Brand.cs') -Encoding UTF8 | Select-Object -First 8
