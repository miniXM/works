#requires -version 7
# 启动一次指定目录里的客户端，报告：有没有窗口、进程有没有秒退、退出码。
param(
    [string]$Dir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\updatetest\app',
    [int]$WaitSeconds = 25
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$appExe = Join-Path $Dir 'videomix\videomix.exe'
$proc = Start-Process -FilePath $appExe -WorkingDirectory (Join-Path $Dir 'videomix') -PassThru
$window = $null
for ($i = 0; $i -lt ($WaitSeconds * 2); $i++) {
    Start-Sleep -Milliseconds 500
    $proc.Refresh()
    if ($proc.HasExited) { break }
    if ($proc.MainWindowHandle -ne 0) { $window = $proc; break }
}
$proc.Refresh()
if ($proc.HasExited) {
    Write-Output ("秒退了：ExitCode={0}" -f $proc.ExitCode)
} elseif ($window) {
    Write-Output ("正常起来并出窗口：{0}" -f $window.MainWindowTitle)
} else {
    Write-Output '进程还活着，但没等到窗口'
}
Get-Process videomix -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
